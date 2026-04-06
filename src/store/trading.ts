import { create } from "zustand";

import {
  type WatchlistEntry,
  WATCHLIST_ENTRIES,
} from "@/lib/watchlist-constants";

export type ChartType = "candlestick" | "line";

const WATCHLIST_STORAGE_KEY = "meridian-watchlist";

function saveWatchlist(entries: WatchlistEntry[]) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(entries));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

type TradingState = {
  activeTicker: string;
  chartType: ChartType;
  watchlistEntries: WatchlistEntry[];
  /** From GET /api/ibkr/me (server-only IBKR_ACCOUNT_ID); undefined until loaded or if unset. */
  ibkrAccountId: string | undefined;
  setActiveTicker: (ticker: string) => void;
  setChartType: (t: ChartType) => void;
  setWatchlistEntries: (entries: WatchlistEntry[]) => void;
  /** Returns false if symbol already present (case-insensitive). */
  addWatchlistEntry: (entry: WatchlistEntry) => boolean;
  setIbkrAccountFromMe: (accountId: string | undefined) => void;
};

export const useTradingStore = create<TradingState>((set, get) => ({
  activeTicker: "AAPL",
  chartType: "candlestick",
  watchlistEntries: WATCHLIST_ENTRIES.map((e) => ({ ...e })),
  ibkrAccountId: undefined,
  setActiveTicker: (activeTicker) => set({ activeTicker }),
  setChartType: (chartType) => set({ chartType }),
  setWatchlistEntries: (watchlistEntries) => {
    saveWatchlist(watchlistEntries);
    set({ watchlistEntries });
  },
  addWatchlistEntry: (entry) => {
    const sym = entry.symbol.trim().toUpperCase();
    if (!sym) return false;
    const { watchlistEntries } = get();
    if (
      watchlistEntries.some(
        (e) => e.symbol.toUpperCase() === sym,
      )
    ) {
      return false;
    }
    const next = [...watchlistEntries, { symbol: sym, conid: entry.conid }];
    saveWatchlist(next);
    set({ watchlistEntries: next });
    return true;
  },
  setIbkrAccountFromMe: (accountId) => set({ ibkrAccountId: accountId }),
}));

export function loadWatchlistFromStorage(): WatchlistEntry[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: WatchlistEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const symbol = String(o.symbol ?? "").trim().toUpperCase();
      const conid = Number(o.conid);
      if (!symbol || !Number.isFinite(conid) || conid <= 0) continue;
      out.push({ symbol, conid });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
