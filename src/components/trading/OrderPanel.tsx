"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PnlSummary } from "@/lib/ibkr-normalize";
import type { WatchlistEntry } from "@/lib/watchlist-constants";
import { formatMoneyStable } from "@/lib/format-display";
import { cn } from "@/lib/utils";
import { useTradingStore } from "@/store/trading";

export type OrderFormValues = {
  symbol: string;
  side: "long" | "short";
  orderType: string;
  quantity: number;
  tif: string;
  price?: string;
};

export type OrderFeedback = {
  kind: "success" | "error" | "info";
  text: string;
};

function pnlHasActivity(p: PnlSummary): boolean {
  const nums = [p.dayPnL, p.unrealizedPnL, p.totalPnL];
  return nums.some((n) => n != null && Number.isFinite(n) && Math.abs(n) > 1e-9);
}

type OrderPanelProps = {
  watchlist: WatchlistEntry[];
  pnl: PnlSummary;
  onSubmit: (values: OrderFormValues) => Promise<void>;
  feedback: OrderFeedback | null;
  submitting: boolean;
};

export function OrderPanel({
  watchlist,
  pnl,
  onSubmit,
  feedback,
  submitting,
}: OrderPanelProps) {
  const activeTicker = useTradingStore((s) => s.activeTicker);

  const [symbol, setSymbol] = useState(activeTicker);
  const [side, setSide] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState("MKT");
  const [quantity, setQuantity] = useState("1");
  const [tif, setTif] = useState("DAY");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (watchlist.some((w) => w.symbol === activeTicker)) {
      setSymbol(activeTicker);
    }
  }, [activeTicker, watchlist]);

  const showPrice = orderType === "LMT" || orderType === "STP";
  const showPnlGrid = useMemo(() => pnlHasActivity(pnl), [pnl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseFloat(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    await onSubmit({
      symbol,
      side,
      orderType,
      quantity: qty,
      tif,
      ...(showPrice && price.trim() !== "" ? { price: price.trim() } : {}),
    });
  }

  function pnlMiniCard(
    label: string,
    value: number,
    valueClass?: string,
  ) {
    return (
      <Card size="sm" className="shadow-none">
        <CardHeader className="pb-1">
          <CardDescription className="text-[10px] font-medium uppercase tracking-wide">
            {label}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <p
            className={cn(
              "font-mono text-base font-semibold tabular-nums",
              valueClass ?? "text-foreground",
            )}
          >
            {value >= 0 ? "+" : ""}
            {formatMoneyStable(value)}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full max-h-full min-h-0 w-[300px] shrink-0 flex-col gap-0 rounded-none border-l border-t-0 border-r-0 border-b-0 py-0 shadow-none">
      <CardHeader className="shrink-0 space-y-1 border-b border-border py-3">
        <CardTitle className="text-sm font-medium">Order</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Active{" "}
          <span className="font-mono text-muted-foreground">{activeTicker}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
        {showPnlGrid ? (
          <div className="shrink-0 border-b border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              {pnlMiniCard(
                "Day P&L",
                pnl.dayPnL,
                pnl.dayPnL >= 0 ? "text-green-600" : "text-red-500",
              )}
              {pnlMiniCard(
                "Unrealized",
                pnl.unrealizedPnL,
                pnl.unrealizedPnL >= 0 ? "text-green-600" : "text-red-500",
              )}
              {pnlMiniCard(
                "Net liq.",
                pnl.totalPnL,
                pnl.totalPnL >= 0 ? "text-green-600" : "text-red-500",
              )}
              <Card size="sm" className="shadow-none">
                <CardHeader className="pb-1">
                  <CardDescription className="text-[10px] font-medium uppercase tracking-wide">
                    Realized
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="font-mono text-base font-semibold tabular-nums text-muted-foreground">
                    —
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-b border-border px-3 py-3">
            <p className="text-center text-xs text-muted-foreground">
              No positions yet — P&amp;L will appear when your account has
              activity.
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-2">
            <div className="space-y-2">
              <label
                htmlFor="order-symbol"
                className="text-sm font-medium text-muted-foreground"
              >
                Symbol
              </label>
              <Select
                value={symbol}
                onValueChange={(v) => {
                  if (v != null) setSymbol(v);
                }}
              >
                <SelectTrigger id="order-symbol" className="w-full shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="shadow-none ring-1 ring-border">
                  {watchlist.map((w) => (
                    <SelectItem key={w.symbol} value={w.symbol}>
                      {w.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">
                Side
              </span>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={side === "long" ? "default" : "outline"}
                  className={cn(
                    "h-11 shadow-none",
                    side === "long" &&
                      "border-green-600 bg-green-600 text-white hover:bg-green-600/90",
                  )}
                  onClick={() => setSide("long")}
                >
                  Long
                </Button>
                <Button
                  type="button"
                  variant={side === "short" ? "default" : "outline"}
                  className={cn(
                    "h-11 shadow-none",
                    side === "short" &&
                      "border-red-500 bg-red-500 text-white hover:bg-red-500/90",
                  )}
                  onClick={() => setSide("short")}
                >
                  Short
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="order-type"
                className="text-sm font-medium text-muted-foreground"
              >
                Order type
              </label>
              <Select
                value={orderType}
                onValueChange={(v) => {
                  if (v != null) setOrderType(v);
                }}
              >
                <SelectTrigger id="order-type" className="w-full shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="shadow-none ring-1 ring-border">
                  <SelectItem value="MKT">MKT</SelectItem>
                  <SelectItem value="LMT">LMT</SelectItem>
                  <SelectItem value="STP">STP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="order-qty"
                className="text-sm font-medium text-muted-foreground"
              >
                Quantity
              </label>
              <Input
                id="order-qty"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="font-mono shadow-none"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="order-tif"
                className="text-sm font-medium text-muted-foreground"
              >
                TIF
              </label>
              <Select
                value={tif}
                onValueChange={(v) => {
                  if (v != null) setTif(v);
                }}
              >
                <SelectTrigger id="order-tif" className="w-full shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="shadow-none ring-1 ring-border">
                  <SelectItem value="DAY">DAY</SelectItem>
                  <SelectItem value="GTC">GTC</SelectItem>
                  <SelectItem value="IOC">IOC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showPrice ? (
              <div className="space-y-2">
                <label
                  htmlFor="order-price"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Price
                </label>
                <Input
                  id="order-price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Limit / stop"
                  className="font-mono shadow-none"
                />
              </div>
            ) : null}
          </div>

          <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border bg-card px-4 py-4">
            <Button
              type="submit"
              disabled={submitting}
              className={cn(
                "h-11 w-full shadow-none",
                side === "long"
                  ? "bg-green-600 text-white hover:bg-green-600/90"
                  : "bg-red-500 text-white hover:bg-red-500/90",
              )}
            >
              {submitting ? "Submitting…" : "Submit order"}
            </Button>

            {feedback ? (
              <p
                role="status"
                className={cn(
                  "w-full rounded-md px-3 py-2 text-xs leading-snug",
                  feedback.kind === "success" &&
                    "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400",
                  feedback.kind === "error" &&
                    "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400",
                  feedback.kind === "info" &&
                    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
                )}
              >
                {feedback.text}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
