"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  type Time,
} from "lightweight-charts";
import { Briefcase } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  type OrderFeedback,
  type OrderFormValues,
  OrderPanel,
} from "@/components/trading/OrderPanel";
import { OpenOrdersSection } from "@/components/trading/OpenOrdersSection";
import { Topbar } from "@/components/trading/Topbar";
import { Watchlist } from "@/components/trading/Watchlist";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
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
import { parseFirstSearchConid } from "@/lib/ibkr-symbol-search";
import { parsePricesResponse } from "@/lib/prices-response";
import { isLikelyYahooTicker } from "@/lib/symbol-validation";
import {
  conidForSymbol,
  type WatchlistEntry,
} from "@/lib/watchlist-constants";
import {
  loadWatchlistFromStorage,
  useTradingStore,
} from "@/store/trading";

/**
 * Prefer a fresh secdef search so the placed order matches the symbol in the form.
 * Stale or wrong `conid` values in localStorage/watchlist caused orders under another ticker.
 */
async function resolveOrderConid(
  symbol: string,
  entries: WatchlistEntry[],
): Promise<number | undefined> {
  const sym = symbol.trim();
  if (!sym) return undefined;
  try {
    const res = await fetch(
      `/api/ibkr/search?symbol=${encodeURIComponent(sym)}`,
    );
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok && data != null) {
      const row = parseFirstSearchConid(data);
      if (row != null) return row.conid;
    }
  } catch {
    /* fall back */
  }
  return conidForSymbol(sym, entries);
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  if (!text) return [] as T;
  return JSON.parse(text) as T;
}

async function positionPricesFetcher(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  return parsePricesResponse(JSON.parse(text) as unknown);
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
  const sumRowUpl = positions.reduce((acc, p) => acc + p.unrealizedPnL, 0);
  const unreal =
    positions.length > 0 ? sumRowUpl : pnl.unrealizedPnL;
  const unrealPos = unreal >= 0;

  const symbolsParam = useMemo(
    () =>
      [
        ...new Set(
          positions
            .map((p) => p.symbol)
            .filter((s) => isLikelyYahooTicker(s)),
        ),
      ].join(","),
    [positions],
  );

  const pricesUrl =
    symbolsParam.length > 0
      ? `/api/prices?symbols=${encodeURIComponent(symbolsParam)}`
      : null;

  const { data: priceData } = useSWR(pricesUrl, positionPricesFetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  return (
    <Card className="shrink-0 py-0 shadow-none">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <CardTitle className="text-sm font-medium">Positions</CardTitle>
        <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
          <span>Unrealized</span>
          <span
            className={cn(
              "font-semibold",
              unrealPos ? "text-green-600" : "text-red-500",
            )}
          >
            {unrealPos ? "+" : ""}
            {formatMoneyStable(unreal)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="p-4 text-sm text-red-500">{error.message}</p>
        ) : isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">
            Loading positions…
          </p>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Briefcase
              className="size-9 text-muted-foreground/50"
              strokeWidth={1.25}
              aria-hidden
            />
            <p className="text-sm font-medium text-foreground">
              No open positions
            </p>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              When you hold a position, it will show here with live marks.
            </p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table className="w-full min-w-[640px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[14%] whitespace-nowrap">
                    Symbol
                  </TableHead>
                  <TableHead className="w-[12%] whitespace-nowrap">
                    Side
                  </TableHead>
                  <TableHead className="w-[10%] whitespace-nowrap text-right">
                    Qty
                  </TableHead>
                  <TableHead className="w-[14%] whitespace-nowrap text-right">
                    Avg
                  </TableHead>
                  <TableHead className="w-[14%] whitespace-nowrap text-right">
                    Last
                  </TableHead>
                  <TableHead className="min-w-[5.5rem] whitespace-nowrap text-right">
                    UPNL
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p, rowIndex) => {
                  const lastPx = priceData?.prices[p.symbol];
                  const hasLast =
                    typeof lastPx === "number" &&
                    Number.isFinite(lastPx) &&
                    lastPx !== 0;
                  const rowKey =
                    p.conid != null && p.conid !== 0
                      ? `pos-${p.conid}-${p.side}`
                      : `pos-${p.symbol}-${p.side}-${rowIndex}`;
                  return (
                    <TableRow key={rowKey}>
                      <TableCell className="truncate font-medium">
                        {p.symbol}
                      </TableCell>
                      <TableCell>
                        {p.side === "long" ? (
                          <Badge
                            variant="outline"
                            className="border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
                          >
                            Long
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600"
                          >
                            Short
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {p.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMoneyStable(p.avgCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {hasLast
                          ? lastPx.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs font-medium tabular-nums",
                          p.unrealizedPnL >= 0
                            ? "text-green-600"
                            : "text-red-500",
                        )}
                      >
                        {p.unrealizedPnL >= 0 ? "+" : ""}
                        {formatMoneyStable(p.unrealizedPnL)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

    el.replaceChildren();
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: text,
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false, color: grid },
        horzLines: { visible: false, color: grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: {
        vertLine: { color: grid, labelBackgroundColor: text },
        horzLine: { color: grid, labelBackgroundColor: text },
      },
      autoSize: true,
    });

    const s = chart.addSeries(CandlestickSeries, {
      upColor: long,
      downColor: short,
      borderUpColor: long,
      borderDownColor: short,
      wickUpColor: long,
      wickDownColor: short,
      lastValueVisible: false,
      priceLineVisible: false,
      baseLineVisible: false,
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

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.resize(el.clientWidth, el.clientHeight, true);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [bars]);

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
    <Card className="flex h-full min-h-0 flex-1 flex-col bg-[var(--chart-bg)] py-0 shadow-none">
      <CardHeader className="shrink-0 space-y-4 border-b border-border">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {activeTicker}
            </CardTitle>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold leading-none tabular-nums sm:text-[28px]">
                {sessionStats?.close != null &&
                Number.isFinite(sessionStats.close)
                  ? sessionStats.close.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "—"}
              </span>
              {hasCh ? (
                <>
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      chPos ? "text-green-600" : "text-red-500",
                    )}
                  >
                    {chPos ? "+" : ""}
                    {ch.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "border-0 font-mono text-xs font-medium tabular-nums",
                      chPos
                        ? "bg-green-50 text-green-600"
                        : "bg-red-50 text-red-500",
                    )}
                  >
                    {chPos ? "+" : ""}
                    {pct.toFixed(2)}%
                  </Badge>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={timeframe}
              onValueChange={(v) => {
                if (v != null) setTimeframe(v as ChartTimeframe);
              }}
              className="w-auto"
            >
              <TabsList variant="line" className="shadow-none">
                {CHART_TIMEFRAMES.map((tf) => (
                  <TabsTrigger
                    key={tf}
                    value={tf}
                    className="font-mono text-xs shadow-none"
                  >
                    {tf}
                  </TabsTrigger>
                ))}
              </TabsList>
              {CHART_TIMEFRAMES.map((tf) => (
                <TabsContent
                  key={tf}
                  value={tf}
                  className="sr-only"
                  aria-hidden
                >
                  .
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative min-h-[200px] w-full min-w-0 flex-1 p-0">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        {showLoader ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--chart-bg)]/90">
            <p className="text-sm font-medium text-muted-foreground">
              Loading chart…
            </p>
          </div>
        ) : null}
        {historyError && !bars?.length ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--chart-bg)]/95 px-4">
            <p className="text-center text-sm text-red-500">
              {historyError.message}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const EMPTY_PNL: PnlSummary = {
  totalPnL: 0,
  dayPnL: 0,
  unrealizedPnL: 0,
};

export default function TradingDashboard() {
  const [mounted, setMounted] = useState(false);
  const watchlistEntries = useTradingStore((s) => s.watchlistEntries);
  const setWatchlistEntries = useTradingStore((s) => s.setWatchlistEntries);
  const ibkrAccountId = useTradingStore((s) => s.ibkrAccountId);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const stored = loadWatchlistFromStorage();
    if (stored?.length) setWatchlistEntries(stored);
  }, [setWatchlistEntries]);

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

  const [orderFeedback, setOrderFeedback] = useState<OrderFeedback | null>(
    null,
  );
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  const handleOrderSubmit = useCallback(
    async (values: OrderFormValues) => {
      setOrderFeedback(null);
      setOrderSubmitting(true);
      try {
        const conid = await resolveOrderConid(
          values.symbol,
          useTradingStore.getState().watchlistEntries,
        );
        if (conid == null) {
          setOrderFeedback({
            kind: "error",
            text: "Could not resolve contract for that symbol.",
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
    <div className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-background">
      <Topbar />
      <div className="flex min-h-0 w-full min-w-0 flex-1 gap-4 overflow-x-auto p-4">
        <div className="flex w-[240px] shrink-0 flex-col">
          <Card className="flex min-h-0 flex-1 flex-col py-0 shadow-none">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm font-medium">Watchlist</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
              <Watchlist embedded />
            </CardContent>
          </Card>
        </div>

        <main className="flex min-h-0 min-w-[min(100%,360px)] flex-1 flex-col gap-4">
          <div className="flex h-[42vh] min-h-[280px] max-h-[640px] shrink-0 flex-col">
            <PriceChartPane />
          </div>
          <Separator className="shrink-0" />
          <PositionsSection
            positions={positions}
            isLoading={!mounted || (Boolean(posLoading) && !posError)}
            error={mounted ? posError : undefined}
            pnl={pnl}
          />
          <Separator className="shrink-0" />
          <OpenOrdersSection
            orders={liveOrders}
            isLoading={
              !mounted || (Boolean(ordersLoading) && !ordersError)
            }
            error={mounted ? ordersError : undefined}
            accountId={ibkrAccountId}
            onRefresh={mutateOrders}
          />
        </main>

        <div className="flex min-h-0 w-[300px] shrink-0 flex-col">
          <OrderPanel
            watchlist={watchlistEntries}
            pnl={pnl}
            onSubmit={handleOrderSubmit}
            feedback={orderFeedback}
            submitting={orderSubmitting}
          />
        </div>
      </div>
    </div>
  );
}
