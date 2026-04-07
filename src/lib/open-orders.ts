import type { LiveOrderRow } from "@/lib/ibkr-normalize";

export const OPEN_ORDERS_REFRESH_MS = 5_000;

/**
 * Whether the row should show cancel actions.
 * CP Web API uses many labels (Working, ApiPending, Queued, …); a short allow-list
 * left "Cancel all" disabled for normal open orders. We deny only clearly terminal states.
 */
export function isOrderCancellableStatus(status: string): boolean {
  const s = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!s || s === "—") return false;

  if (
    s === "filled" ||
    s === "cancelled" ||
    s === "apicancelled" ||
    s === "donefortheday" ||
    s.includes("pendingcancel")
  ) {
    return false;
  }
  if (s.includes("reject") || s.includes("apierror") || s.includes("error")) {
    return false;
  }

  return true;
}

/** Tailwind classes for {@link Badge} (pending / filled / cancelled / error / neutral). */
export function openOrderStatusClass(status: string): string {
  const s = status.toLowerCase().replace(/\s+/g, "");
  if (s.includes("reject") || s.includes("apierror") || s.includes("error")) {
    return "border-0 bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400";
  }
  if (s.includes("cancel")) {
    return "border-0 bg-muted text-muted-foreground";
  }
  if (s.includes("fill")) {
    return "border-0 bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400";
  }
  if (
    s.includes("presubmitted") ||
    s.includes("submitted") ||
    s === "pendingsubmit" ||
    s.includes("working") ||
    s.includes("apipending") ||
    s.includes("queued")
  ) {
    return "border-0 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400";
  }
  return "border-0 bg-muted text-muted-foreground";
}

export async function deleteIbkrOrderRequest(
  orderId: string,
  accountId?: string,
): Promise<void> {
  const params = new URLSearchParams({ orderId });
  if (accountId?.trim()) {
    params.set("accountId", accountId.trim());
  }
  const res = await fetch(`/api/ibkr/orders?${params.toString()}`, {
    method: "DELETE",
  });
  const text = await res.text();
  if (res.ok) return;
  let message = `Cancel failed (${res.status})`;
  try {
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
    ) {
      message = (data as { error: string }).error;
    } else if (text) {
      message = text.slice(0, 240);
    }
  } catch {
    if (text) message = text.slice(0, 240);
  }
  throw new Error(message);
}

export function listCancellableOrders(rows: LiveOrderRow[]): LiveOrderRow[] {
  return rows.filter((r) => isOrderCancellableStatus(r.status));
}

export async function cancelAllCancellableOrders(
  rows: LiveOrderRow[],
  accountId?: string,
): Promise<void> {
  const targets = listCancellableOrders(rows);
  /** Sequential: parallel DELETEs often race the IBKR session and silently fail. */
  for (const r of targets) {
    await deleteIbkrOrderRequest(r.orderId, accountId);
  }
}
