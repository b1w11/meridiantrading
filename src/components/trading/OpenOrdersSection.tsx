"use client";

import { ClipboardList } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
  /** Passed as `accountId` on DELETE when set (from `/api/ibkr/me` via trading store). */
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
  const [orderActionError, setOrderActionError] = useState<string | null>(null);

  const handleCancelOne = useCallback(
    async (orderId: string) => {
      setOrderActionError(null);
      setCancellingId(orderId);
      try {
        await deleteIbkrOrderRequest(orderId, accountId);
        await onRefresh();
      } catch (e) {
        setOrderActionError(
          e instanceof Error ? e.message : "Cancel request failed",
        );
      } finally {
        setCancellingId(null);
      }
    },
    [accountId, onRefresh],
  );

  const handleCancelAll = useCallback(async () => {
    setOrderActionError(null);
    setCancellingAll(true);
    try {
      await cancelAllCancellableOrders(orders, accountId);
      await onRefresh();
    } catch (e) {
      setOrderActionError(
        e instanceof Error ? e.message : "Cancel all failed",
      );
    } finally {
      setCancellingAll(false);
    }
  }, [accountId, onRefresh, orders]);

  const cancellableCount = orders.filter((r) =>
    isOrderCancellableStatus(r.status),
  ).length;

  return (
    <Card className="flex min-h-0 flex-1 flex-col py-0 shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <CardTitle className="text-sm font-medium">Open orders</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-red-500 shadow-none hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
          onClick={() => void handleCancelAll()}
          disabled={
            cancellingAll || cancellableCount === 0 || Boolean(error)
          }
        >
          {cancellingAll ? "Cancelling…" : "Cancel all orders"}
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {orderActionError ? (
          <p className="border-b border-border bg-red-50 px-4 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {orderActionError}
          </p>
        ) : null}
        {error ? (
          <p className="p-4 text-sm text-red-500">{error.message}</p>
        ) : isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading orders…</p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <ClipboardList
              className="size-9 text-muted-foreground/45"
              strokeWidth={1.25}
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground">No open orders</p>
            <p className="max-w-[260px] text-xs text-muted-foreground">
              Working orders will appear here. Submit from the order panel or your
              broker.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Order ID</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row, idx) => {
                const canCancel = isOrderCancellableStatus(row.status);
                return (
                  <TableRow key={`${row.orderId}-${idx}`}>
                    <TableCell className="font-medium">{row.orderId}</TableCell>
                    <TableCell>{row.symbol}</TableCell>
                    <TableCell
                      className={cn(
                        "font-mono text-xs",
                        row.side === "BUY" && "text-green-600",
                        row.side === "SELL" && "text-red-500",
                      )}
                    >
                      {row.side}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.orderType}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          "font-mono text-[10px] font-normal",
                          openOrderStatusClass(row.status),
                        )}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.orderTime}
                    </TableCell>
                    <TableCell className="text-right">
                      {canCancel ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={cancellingId === row.orderId}
                          className="h-7 border-red-200 text-xs text-red-500 shadow-none hover:bg-red-50 dark:border-red-900"
                          onClick={() => void handleCancelOne(row.orderId)}
                        >
                          {cancellingId === row.orderId ? "…" : "Cancel"}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
