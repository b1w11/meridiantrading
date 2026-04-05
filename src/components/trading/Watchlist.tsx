"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatPriceStable } from "@/lib/format-display";
import { parseFirstSearchConid } from "@/lib/ibkr-symbol-search";
import { mergeStickyLastPrices } from "@/lib/ibkr-normalize";
import { parsePricesResponse } from "@/lib/prices-response";
import type { WatchlistEntry } from "@/lib/watchlist-constants";
import { companyNameForSymbol } from "@/lib/watchlist-display";
import { cn } from "@/lib/utils";
import { useTradingStore } from "@/store/trading";

export type { WatchlistEntry };

async function pricesFetcher(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  return parsePricesResponse(JSON.parse(text) as unknown);
}

type WatchlistProps = {
  /** @deprecated List is read from the trading store. */
  entries?: WatchlistEntry[];
  /** When true, render only the scrollable list (parent supplies Card chrome). */
  embedded?: boolean;
};

export function Watchlist({ embedded = false }: WatchlistProps) {
  const activeTicker = useTradingStore((s) => s.activeTicker);
  const setActiveTicker = useTradingStore((s) => s.setActiveTicker);
  const entries = useTradingStore((s) => s.watchlistEntries);
  const addWatchlistEntry = useTradingStore((s) => s.addWatchlistEntry);

  const [mounted, setMounted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

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

  async function submitNewSymbol() {
    const raw = newSymbol.trim().toUpperCase();
    setAddError(null);
    if (!raw) {
      setAdding(false);
      setNewSymbol("");
      return;
    }
    if (entries.some((e) => e.symbol.toUpperCase() === raw)) {
      setAddError("Already in list");
      return;
    }
    setAddBusy(true);
    try {
      const res = await fetch(
        `/api/ibkr/search?symbol=${encodeURIComponent(raw)}`,
      );
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
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
            : `Search failed (${res.status})`;
        setAddError(msg);
        return;
      }
      const row = parseFirstSearchConid(data);
      if (!row) {
        setAddError("No contract found");
        return;
      }
      const added = addWatchlistEntry(row);
      if (!added) {
        setAddError("Already in list");
        return;
      }
      setActiveTicker(row.symbol);
      setNewSymbol("");
      setAdding(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setAddBusy(false);
    }
  }

  const list = (
    <>
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
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0",
                  on
                    ? "border-l-2 border-l-foreground bg-muted/40 pl-[10px]"
                    : "border-l-2 border-l-transparent hover:bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{symbol}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {companyNameForSymbol(symbol)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        pricesLoading && "animate-pulse",
                      )}
                    >
                      {formatPriceStable(last)}
                    </span>
                    {hasPct ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "border-0 font-mono text-[10px] font-medium tabular-nums",
                          pos
                            ? "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400"
                            : "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400",
                        )}
                      >
                        {pos ? "+" : ""}
                        {pct.toFixed(2)}%
                      </Badge>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground">
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
      <div className="shrink-0 border-t border-border p-2">
        {adding ? (
          <div className="flex flex-col gap-1.5">
            <Input
              ref={inputRef}
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitNewSymbol();
                if (e.key === "Escape") {
                  setAdding(false);
                  setNewSymbol("");
                  setAddError(null);
                }
              }}
              placeholder="Symbol"
              disabled={addBusy}
              className="h-8 font-mono text-xs shadow-none"
              aria-label="Symbol to add"
            />
            {addError ? (
              <p className="text-[10px] text-red-500">{addError}</p>
            ) : null}
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 flex-1 text-xs shadow-none"
                disabled={addBusy}
                onClick={() => void submitNewSymbol()}
              >
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs shadow-none"
                disabled={addBusy}
                onClick={() => {
                  setAdding(false);
                  setNewSymbol("");
                  setAddError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full gap-1.5 text-xs text-muted-foreground shadow-none hover:text-foreground"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" aria-hidden />
            Add symbol
          </Button>
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{list}</div>;
  }

  return (
    <aside className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-3 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Watchlist
        </h2>
      </div>
      {list}
    </aside>
  );
}
