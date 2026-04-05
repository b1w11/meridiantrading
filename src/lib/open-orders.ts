import type { LiveOrderRow } from "@/lib/ibkr-normalize";

export const OPEN_ORDERS_REFRESH_MS = 5_000;

/** Statuses that may be cancelled via IBKR (case-insensitive). */
export function isOrderCancellableStatus(status: string): boolean {
  const s = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return (
    s === "presubmitted" ||
    s === "submitted" ||
    s === "pendingsubmit" ||
    s === "pendingsubmitted"
  );
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
    s === "pendingsubmit"
  ) {
    return "border-0 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400";
  }
  return "border-0 bg-muted text-muted-foreground";
}

export async function deleteIbkrOrderRequest(
  orderId: string,
  accountId?: string,
): Promise<Response> {
  const params = new URLSearchParams({ orderId });
  if (accountId?.trim()) {
    params.set("accountId", accountId.trim());
  }
  return fetch(`/api/ibkr/orders?${params.toString()}`, { method: "DELETE" });
}

export function listCancellableOrders(rows: LiveOrderRow[]): LiveOrderRow[] {
  return rows.filter((r) => isOrderCancellableStatus(r.status));
}

export async function cancelAllCancellableOrders(
  rows: LiveOrderRow[],
  accountId?: string,
): Promise<void> {
  const targets = listCancellableOrders(rows);
  await Promise.all(
    targets.map((r) => deleteIbkrOrderRequest(r.orderId, accountId)),
  );
}
