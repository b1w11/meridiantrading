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

/** Status pill classes (design tokens: pending / filled / cancelled / error / neutral). */
export function openOrderStatusClass(status: string): string {
  const s = status.toLowerCase().replace(/\s+/g, "");
  if (s.includes("reject") || s.includes("apierror") || s.includes("error")) {
    return "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]";
  }
  if (s.includes("cancel")) {
    return "bg-[var(--status-cancelled-bg)] text-[var(--status-cancelled-fg)]";
  }
  if (s.includes("fill")) {
    return "bg-[var(--status-filled-bg)] text-[var(--status-filled-fg)]";
  }
  if (
    s.includes("presubmitted") ||
    s.includes("submitted") ||
    s === "pendingsubmit"
  ) {
    return "bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]";
  }
  return "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]";
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
