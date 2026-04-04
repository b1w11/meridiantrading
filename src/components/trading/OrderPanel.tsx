"use client";

import { useEffect, useState } from "react";

import type { PnlSummary } from "@/lib/ibkr-normalize";
import { formatMoneyStable } from "@/lib/format-display";
import { useTradingStore } from "@/store/trading";

import type { WatchlistEntry } from "./Watchlist";

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

type OrderPanelProps = {
  watchlist: WatchlistEntry[];
  pnl: PnlSummary;
  onSubmit: (values: OrderFormValues) => Promise<void>;
  feedback: OrderFeedback | null;
  submitting: boolean;
};

const inputClass =
  "w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--foreground-subtle)] focus:border-[var(--foreground-muted)] focus:ring-1 focus:ring-[var(--foreground-muted)]";

const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]";

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

  const pnlCard = (label: string, value: number, valueClass?: string) => (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-muted)]">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-lg font-semibold tabular-nums tracking-tight ${valueClass ?? "text-[var(--foreground)]"}`}
      >
        {value >= 0 ? "+" : ""}
        {formatMoneyStable(value)}
      </div>
    </div>
  );

  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Order
        </h2>
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col gap-4 overflow-y-auto p-3"
      >
        <div className="grid grid-cols-2 gap-2">
          {pnlCard(
            "Day P&L",
            pnl.dayPnL,
            pnl.dayPnL >= 0 ? "text-[var(--long)]" : "text-[var(--short)]",
          )}
          {pnlCard(
            "Unrealized",
            pnl.unrealizedPnL,
            pnl.unrealizedPnL >= 0 ? "text-[var(--long)]" : "text-[var(--short)]",
          )}
          {pnlCard(
            "Net liquidation",
            pnl.totalPnL,
            pnl.totalPnL >= 0 ? "text-[var(--long)]" : "text-[var(--short)]",
          )}
          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-muted)]">
              Realized (session)
            </div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-[var(--foreground-muted)]">
              —
            </div>
          </div>
        </div>
        <p className="-mt-1 text-center text-[10px] text-[var(--foreground-subtle)]">
          Active:{" "}
          <span className="font-mono text-[var(--foreground-muted)]">
            {activeTicker}
          </span>
        </p>

        <div>
          <label htmlFor="order-symbol" className={labelClass}>
            Symbol
          </label>
          <select
            id="order-symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className={inputClass}
          >
            {watchlist.map((w) => (
              <option key={w.symbol} value={w.symbol}>
                {w.symbol}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className={labelClass}>Side</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSide("long")}
              className={`rounded-[6px] py-3 text-sm font-semibold transition-colors ${
                side === "long"
                  ? "bg-[var(--long)] text-white shadow-sm"
                  : "border border-[var(--border)] bg-[var(--page-bg)] text-[var(--foreground-muted)] hover:bg-[var(--hover-row)]"
              }`}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => setSide("short")}
              className={`rounded-[6px] py-3 text-sm font-semibold transition-colors ${
                side === "short"
                  ? "bg-[var(--short)] text-white shadow-sm"
                  : "border border-[var(--border)] bg-[var(--page-bg)] text-[var(--foreground-muted)] hover:bg-[var(--hover-row)]"
              }`}
            >
              Short
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="order-type" className={labelClass}>
            Order type
          </label>
          <select
            id="order-type"
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
            className={inputClass}
          >
            <option value="MKT">MKT</option>
            <option value="LMT">LMT</option>
            <option value="STP">STP</option>
          </select>
        </div>

        <div>
          <label htmlFor="order-qty" className={labelClass}>
            Quantity
          </label>
          <input
            id="order-qty"
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="order-tif" className={labelClass}>
            TIF
          </label>
          <select
            id="order-tif"
            value={tif}
            onChange={(e) => setTif(e.target.value)}
            className={inputClass}
          >
            <option value="DAY">DAY</option>
            <option value="GTC">GTC</option>
            <option value="IOC">IOC</option>
          </select>
        </div>

        {showPrice ? (
          <div>
            <label htmlFor="order-price" className={labelClass}>
              Price
            </label>
            <input
              id="order-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Limit / stop"
              className={inputClass}
            />
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className={`h-12 w-full rounded-[6px] text-sm font-semibold text-white transition-opacity hover:opacity-95 disabled:opacity-50 ${
            side === "long" ? "bg-[var(--long)]" : "bg-[var(--short)]"
          }`}
        >
          {submitting ? "Submitting…" : "Submit order"}
        </button>

        {feedback ? (
          <p
            role="status"
            className={`rounded-[6px] px-3 py-2 text-xs leading-snug ${
              feedback.kind === "success"
                ? "bg-[var(--long-bg)] text-[var(--long)]"
                : feedback.kind === "error"
                  ? "bg-[var(--short-bg)] text-[var(--short)]"
                  : "bg-[var(--pending-bg)] text-[var(--pending)]"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}
      </form>
    </aside>
  );
}
