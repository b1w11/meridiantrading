"use client";

import { useCallback, useState } from "react";

import type { LiveOrderRow } from "@/lib/ibkr-normalize";
import {
  cancelAllCancellableOrders,
  deleteIbkrOrderRequest,
  isOrderCancellableStatus,
  openOrderStatusClass,
} from "@/lib/open-orders";

type OpenOrdersSectionProps = {
  orders: LiveOrderRow[];
  isLoading: boolean;
  error: Error | undefined;
  /** Passed as `accountId` on DELETE when set (e.g. NEXT_PUBLIC_IBKR_ACCOUNT_ID). */
  accountId: string | undefined;
  onRefresh: () => Promise<unknown>;
};

export function OpenOrdersSection({
  orders,
  isLoading,
  error,
  accountId,
  onRefresh,
}: OpenOrdersSectionProps) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);

  const handleCancelOne = useCallback(
    async (orderId: string) => {
      setCancellingId(orderId);
      try {
        await deleteIbkrOrderRequest(orderId, accountId);
        await onRefresh();
      } finally {
        setCancellingId(null);
      }
    },
    [accountId, onRefresh],
  );

  const handleCancelAll = useCallback(async () => {
    setCancellingAll(true);
    try {
      await cancelAllCancellableOrders(orders, accountId);
      await onRefresh();
    } finally {
      setCancellingAll(false);
    }
  }, [accountId, onRefresh, orders]);

  const cancellableCount = orders.filter((r) =>
    isOrderCancellableStatus(r.status),
  ).length;

  return (
    <section className="flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Open orders
        </h2>
        <button
          type="button"
          onClick={() => void handleCancelAll()}
          disabled={
            cancellingAll || cancellableCount === 0 || Boolean(error)
          }
          className="text-xs font-semibold text-[var(--short)] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {cancellingAll ? "Cancelling…" : "Cancel all orders"}
        </button>
      </div>
      <div className="overflow-x-auto">
        {error ? (
          <p className="p-4 text-sm text-[var(--short)]">{error.message}</p>
        ) : isLoading ? (
          <p className="p-4 text-sm text-[var(--foreground-muted)]">
            Loading orders…
          </p>
        ) : orders.length === 0 ? (
          <p className="p-4 text-sm text-[var(--foreground-muted)]">
            No open orders.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-muted)]">
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Order ID
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Symbol
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Side
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Type
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-right font-medium">
                  Qty
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Status
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Time
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums text-[var(--foreground)]">
              {orders.map((row, idx) => {
                const canCancel = isOrderCancellableStatus(row.status);
                return (
                  <tr
                    key={`${row.orderId}-${idx}`}
                    className="border-b border-[var(--border)] odd:bg-[var(--row-alt)] hover:bg-[var(--hover-row)]"
                  >
                    <td className="px-3 py-2 font-medium">{row.orderId}</td>
                    <td className="px-3 py-2">{row.symbol}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.side === "BUY"
                            ? "text-[var(--long)]"
                            : row.side === "SELL"
                              ? "text-[var(--short)]"
                              : ""
                        }
                      >
                        {row.side}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.orderType}</td>
                    <td className="px-3 py-2 text-right">{row.quantity}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-[6px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${openOrderStatusClass(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[var(--foreground-muted)]">
                      {row.orderTime}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canCancel ? (
                        <button
                          type="button"
                          disabled={cancellingId === row.orderId}
                          onClick={() => void handleCancelOne(row.orderId)}
                          className="rounded-[6px] border border-[var(--short)] bg-transparent px-2 py-1 text-[10px] font-semibold text-[var(--short)] transition-colors hover:bg-[var(--short-bg)] disabled:opacity-50"
                        >
                          {cancellingId === row.orderId ? "…" : "Cancel"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
