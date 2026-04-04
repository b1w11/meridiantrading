"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  type OrderFeedback,
  type OrderFormValues,
  OrderPanel,
} from "@/components/trading/OrderPanel";
import { OpenOrdersSection } from "@/components/trading/OpenOrdersSection";
import { useMeridianTheme } from "@/components/ThemeProvider";
import { Topbar } from "@/components/trading/Topbar";
import { Watchlist } from "@/components/trading/Watchlist";
import type { PositionRow } from "@/hooks/useIBKR";
import {
  normalizeLiveOrders,
  normalizePnl,
  normalizePositions,
  type PnlSummary,
} from "@/lib/ibkr-normalize";
import { OPEN_ORDERS_REFRESH_MS } from "@/lib/open-orders";
import {
  CHART_TIMEFRAMES,
  type ChartOHLCBar,
  type ChartTimeframe,
} from "@/lib/chart-history";
import { formatMoneyStable } from "@/lib/format-display";
import { conidForSymbol, WATCHLIST_ENTRIES } from "@/lib/watchlist-constants";
import { useTradingStore, type ChartType } from "@/store/trading";

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  if (!text) return [] as T;
  return JSON.parse(text) as T;
}

async function historyFetcher(url: string): Promise<ChartOHLCBar[]> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    if (data && typeof data === "object" && data !== null && "error" in data) {
      throw new Error(
        String((data as { error: unknown }).error ?? "Unknown error"),
      );
    }
    return [];
  }
  return data as ChartOHLCBar[];
}

function describeOrderResult(data: unknown): OrderFeedback {
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    if (first.order_id != null || first.order_status != null) {
      return {
        kind: "success",
        text: `Order ${String(first.order_status ?? "submitted")} (id ${String(first.order_id ?? "—")})`,
      };
    }
    if (Array.isArray(first.message) && first.id != null) {
      return {
        kind: "info",
        text:
          "Broker returned a confirmation prompt. Finish in Client Portal or review the response.",
      };
    }
  }
  return { kind: "success", text: "Order request completed." };
}

function PositionsSection({
  positions,
  isLoading,
  error,
  pnl,
}: {
  positions: PositionRow[];
  isLoading: boolean;
  error: Error | undefined;
  pnl: PnlSummary;
}) {
  const unreal = pnl.unrealizedPnL;
  const unrealPos = unreal >= 0;
  return (
    <section className="flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Positions
        </h2>
        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
          <span className="text-[var(--foreground-muted)]">Unrealized</span>
          <span
            className={
              unrealPos ? "font-semibold text-[var(--long)]" : "font-semibold text-[var(--short)]"
            }
          >
            {unrealPos ? "+" : ""}
            {formatMoneyStable(unreal)}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        {error ? (
          <p className="p-4 text-sm text-[var(--short)]">{error.message}</p>
        ) : isLoading ? (
          <p className="p-4 text-sm text-[var(--foreground-muted)]">
            Loading positions…
          </p>
        ) : positions.length === 0 ? (
          <p className="p-4 text-sm text-[var(--foreground-muted)]">
            No open positions.
          </p>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] font-medium uppercase tracking-wider text-[var(--foreground-muted)]">
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Symbol
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 font-medium">
                  Side
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-right font-medium">
                  Qty
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-right font-medium">
                  Avg
                </th>
                <th className="sticky top-0 bg-[var(--surface)] px-3 py-2 text-right font-medium">
                  UPNL
                </th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums text-[var(--foreground)]">
              {positions.map((p, i) => (
                <tr
                  key={`${p.symbol}-${p.side}`}
                  className={`border-b border-[var(--border)] hover:bg-[var(--hover-row)] ${i % 2 === 1 ? "bg-[var(--row-alt)]" : ""}`}
                >
                  <td className="px-3 py-2.5 font-semibold text-[var(--foreground)]">
                    {p.symbol}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-[6px] px-2 py-0.5 text-[10px] font-semibold ${
                        p.side === "long"
                          ? "bg-[var(--long-bg)] text-[var(--long)]"
                          : "bg-[var(--short-bg)] text-[var(--short)]"
                      }`}
                    >
                      {p.side === "long" ? "Long" : "Short"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{p.quantity}</td>
                  <td className="px-3 py-2.5 text-right">
                    {formatMoneyStable(p.avgCost)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-medium ${
                      p.unrealizedPnL >= 0
                        ? "text-[var(--long)]"
                        : "text-[var(--short)]"
                    }`}
                  >
                    {p.unrealizedPnL >= 0 ? "+" : ""}
                    {formatMoneyStable(p.unrealizedPnL)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const chartModes: { id: ChartType; label: string }[] = [
  { id: "candlestick", label: "Candles" },
  { id: "line", label: "Line" },
];

function readCssColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return v || fallback;
}

function PriceChartPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeTicker = useTradingStore((s) => s.activeTicker);
  const chartType = useTradingStore((s) => s.chartType);
  const setChartType = useTradingStore((s) => s.setChartType);
  const { theme } = useMeridianTheme();

  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setTimeframe("1D");
  }, [activeTicker]);

  const historyUrl =
    mounted && activeTicker
      ? `/api/prices/history?${new URLSearchParams({
          symbol: activeTicker,
          timeframe,
        }).toString()}`
      : null;

  const {
    data: bars,
    error: historyError,
    isLoading: historyLoading,
    isValidating: historyValidating,
  } = useSWR(historyUrl, historyFetcher, { revalidateOnFocus: false });

  const sessionStats = useMemo(() => {
    if (!bars?.length) return null;
    const last = bars[bars.length - 1];
    const first = bars[0];
    const ref = first.open ?? first.close;
    const close = last.close;
    if (!Number.isFinite(ref) || ref === 0 || !Number.isFinite(close)) {
      return { close, change: null as number | null, pct: null as number | null };
    }
    const change = close - ref;
    const pct = (change / ref) * 100;
    return { close, change, pct };
  }, [bars]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    if (!bars?.length) {
      el.replaceChildren();
      return undefined;
    }

    const bg = readCssColor("--chart-bg", "#f7f7f5");
    const grid = readCssColor("--chart-grid", "#e5e5e3");
    const text = readCssColor("--chart-text", "#525252");
    const long = readCssColor("--long", "#22c55e");
    const short = readCssColor("--short", "#ef4444");
    const lineColor = readCssColor("--foreground-muted", "#737373");

    el.replaceChildren();
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: {
        vertLine: { color: grid, labelBackgroundColor: text },
        horzLine: { color: grid, labelBackgroundColor: text },
      },
      autoSize: true,
    });

    if (chartType === "candlestick") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: long,
        downColor: short,
        borderUpColor: long,
        borderDownColor: short,
        wickUpColor: long,
        wickDownColor: short,
      });
      s.setData(
        bars.map((b) => ({
          time: b.time as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );
    } else {
      const s = chart.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 2,
      });
      s.setData(
        bars.map((b) => ({
          time: b.time as Time,
          value: b.close,
        })),
      );
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, el.clientHeight, true);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [bars, chartType, theme]);

  const showLoader =
    mounted &&
    !historyError &&
    !bars?.length &&
    (historyLoading || historyValidating);

  const ch = sessionStats?.change;
  const pct = sessionStats?.pct;
  const hasCh = ch != null && pct != null && Number.isFinite(ch) && Number.isFinite(pct);
  const chPos = hasCh && ch >= 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--chart-bg)]">
      <div className="flex shrink-0 flex-col gap-3 px-3 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              {activeTicker}
            </h2>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[28px] font-semibold leading-none tabular-nums tracking-tight text-[var(--foreground)]">
                {sessionStats?.close != null && Number.isFinite(sessionStats.close)
                  ? sessionStats.close.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "—"}
              </span>
              {hasCh ? (
                <>
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      chPos ? "text-[var(--long)]" : "text-[var(--short)]"
                    }`}
                  >
                    {chPos ? "+" : ""}
                    {ch.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                      chPos
                        ? "bg-[var(--long-bg)] text-[var(--long)]"
                        : "bg-[var(--short-bg)] text-[var(--short)]"
                    }`}
                  >
                    {chPos ? "+" : ""}
                    {pct.toFixed(2)}%
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-0.5"
              role="group"
              aria-label="Chart style"
            >
              {chartModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setChartType(m.id)}
                  className={`rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    chartType === m.id
                      ? "bg-[var(--foreground)] text-[var(--surface)]"
                      : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label="Chart range"
            >
              {CHART_TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="tab"
                  aria-selected={timeframe === tf}
                  onClick={() => setTimeframe(tf)}
                  className={`rounded-full px-3 py-1 font-mono text-[11px] font-medium transition-colors ${
                    timeframe === tf
                      ? "bg-[var(--foreground)] text-[var(--page-bg)]"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)] hover:border-[var(--foreground-muted)]"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="relative min-h-[200px] w-full min-w-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        {showLoader ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--chart-bg)]/90">
            <p className="text-sm font-medium text-[var(--foreground-muted)]">
              Loading chart…
            </p>
          </div>
        ) : null}
        {historyError && !bars?.length ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--chart-bg)]/95 px-4">
            <p className="text-center text-sm text-[var(--short)]">
              {historyError.message}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Single source for watchlist rows; SWR marketdata URL is derived from the same list. */
const WATCHLIST = WATCHLIST_ENTRIES;

const EMPTY_PNL: PnlSummary = {
  totalPnL: 0,
  dayPnL: 0,
  unrealizedPnL: 0,
};

export default function TradingDashboard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    data: posRaw,
    error: posError,
    isLoading: posLoading,
    mutate: mutatePositions,
  } = useSWR<unknown>("/api/ibkr/positions", jsonFetcher, {
    refreshInterval: 5000,
  });

  const { data: pnlRaw, mutate: mutatePnl } = useSWR<unknown>(
    "/api/ibkr/pnl",
    jsonFetcher,
    { refreshInterval: 5000 },
  );

  const {
    data: ordersRaw,
    error: ordersError,
    isLoading: ordersLoading,
    mutate: mutateOrders,
  } = useSWR<unknown>("/api/ibkr/orders", jsonFetcher, {
    refreshInterval: OPEN_ORDERS_REFRESH_MS,
  });

  const positions = normalizePositions(posRaw ?? []);
  const pnl = normalizePnl(pnlRaw ?? null);
  const liveOrders = normalizeLiveOrders(ordersRaw ?? []);

  const ibkrAccountId =
    typeof process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID === "string"
      ? process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID.trim() || undefined
      : undefined;

  const [orderFeedback, setOrderFeedback] = useState<OrderFeedback | null>(
    null,
  );
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  const handleOrderSubmit = useCallback(
    async (values: OrderFormValues) => {
      setOrderFeedback(null);
      setOrderSubmitting(true);
      try {
        const conid = conidForSymbol(values.symbol, WATCHLIST);
        if (conid == null) {
          setOrderFeedback({
            kind: "error",
            text: "Unknown symbol for this watchlist.",
          });
          return;
        }

        const body: Record<string, unknown> = {
          conid,
          side: values.side,
          orderType: values.orderType,
          quantity: values.quantity,
          tif: values.tif,
        };
        const px =
          values.price != null && values.price !== ""
            ? Number(values.price)
            : NaN;
        if (values.orderType === "LMT" && Number.isFinite(px)) {
          body.price = px;
        }
        if (values.orderType === "STP" && Number.isFinite(px)) {
          body.stopPrice = px;
        }

        const res = await fetch("/api/ibkr/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        let data: unknown;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (!res.ok) {
          const msg =
            data &&
            typeof data === "object" &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : JSON.stringify(data ?? { status: res.status });
          setOrderFeedback({ kind: "error", text: msg });
          return;
        }

        const fb = describeOrderResult(data);
        setOrderFeedback(fb);
        if (fb.kind === "success") {
          await Promise.all([
            mutatePositions(),
            mutatePnl(),
            mutateOrders(),
          ]);
        }
      } catch (e) {
        setOrderFeedback({
          kind: "error",
          text: e instanceof Error ? e.message : "Order failed",
        });
      } finally {
        setOrderSubmitting(false);
      }
    },
    [mutatePositions, mutatePnl, mutateOrders],
  );

  return (
    <div className="grid min-h-screen grid-rows-[52px_1fr] bg-[var(--page-bg)]">
      <Topbar />
      <div className="grid min-h-0 grid-cols-[240px_1fr_300px] items-stretch border-t border-[var(--border)]">
        <Watchlist entries={WATCHLIST} />
        <main className="min-w-0 overflow-hidden bg-[var(--page-bg)]">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-[42vh] min-h-[280px] max-h-[640px] shrink-0 flex-col">
              <PriceChartPane />
            </div>
            <PositionsSection
              positions={positions}
              isLoading={
                !mounted || (Boolean(posLoading) && !posError)
              }
              error={mounted ? posError : undefined}
              pnl={pnl}
            />
            <OpenOrdersSection
              orders={liveOrders}
              isLoading={
                !mounted ||
                (Boolean(ordersLoading) && !ordersError)
              }
              error={mounted ? ordersError : undefined}
              accountId={ibkrAccountId}
              onRefresh={mutateOrders}
            />
          </div>
        </main>
        <OrderPanel
          watchlist={WATCHLIST}
          pnl={pnl}
          onSubmit={handleOrderSubmit}
          feedback={orderFeedback}
          submitting={orderSubmitting}
        />
      </div>
    </div>
  );
}
