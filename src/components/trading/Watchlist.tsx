"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { formatPriceStable } from "@/lib/format-display";
import { mergeStickyLastPrices } from "@/lib/ibkr-normalize";
import { parsePricesResponse } from "@/lib/prices-response";
import { companyNameForSymbol } from "@/lib/watchlist-display";
import { useTradingStore } from "@/store/trading";

export type WatchlistEntry = { symbol: string; conid: number };

async function pricesFetcher(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  return parsePricesResponse(JSON.parse(text) as unknown);
}

type WatchlistProps = {
  entries: WatchlistEntry[];
};

export function Watchlist({ entries }: WatchlistProps) {
  const activeTicker = useTradingStore((s) => s.activeTicker);
  const setActiveTicker = useTradingStore((s) => s.setActiveTicker);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const symbolsParam = useMemo(
    () =>
      entries
        .map((e) => e.symbol.trim())
        .filter(Boolean)
        .join(","),
    [entries],
  );

  const pricesUrl =
    mounted && symbolsParam.length > 0
      ? `/api/prices?symbols=${encodeURIComponent(symbolsParam)}`
      : null;

  const { data: parsed, isLoading, error } = useSWR(
    pricesUrl,
    pricesFetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );

  const stashRef = useRef<Record<string, number>>({});

  const lastBySymbol = useMemo(() => {
    if (!mounted || !parsed) return {};
    const fresh: Record<string, number | null> = {};
    for (const { symbol } of entries) {
      const v = parsed.prices[symbol];
      fresh[symbol] =
        typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;
    }
    const { merged, stash } = mergeStickyLastPrices(
      fresh,
      entries,
      stashRef.current,
    );
    stashRef.current = stash;
    return merged;
  }, [mounted, entries, parsed]);

  const pricesLoading =
    !mounted || (Boolean(isLoading) && !error && !parsed);

  return (
    <aside className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          Watchlist
        </h2>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col">
          {entries.map(({ symbol }) => {
            const on = symbol === activeTicker;
            const last = lastBySymbol[symbol];
            const pct = parsed?.pctChange[symbol];
            const hasPct = pct != null && Number.isFinite(pct);
            const pos = hasPct && pct >= 0;
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => setActiveTicker(symbol)}
                className={`flex w-full flex-col gap-0.5 border-b border-[var(--border)] px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                  on
                    ? "border-l-2 border-l-[var(--primary-accent)] bg-[var(--row-alt)] pl-[10px]"
                    : "border-l-2 border-l-transparent hover:bg-[var(--hover-row)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--foreground)]">
                      {symbol}
                    </div>
                    <div className="truncate text-[11px] text-[var(--foreground-muted)]">
                      {companyNameForSymbol(symbol)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`font-mono text-sm tabular-nums text-[var(--foreground)] ${
                        pricesLoading ? "animate-pulse" : ""
                      }`}
                    >
                      {formatPriceStable(last)}
                    </span>
                    {hasPct ? (
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${
                          pos
                            ? "bg-[var(--long-bg)] text-[var(--long)]"
                            : "bg-[var(--short-bg)] text-[var(--short)]"
                        }`}
                      >
                        {pos ? "+" : ""}
                        {pct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="rounded-md bg-[var(--row-alt)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--foreground-muted)]">
                        —
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
