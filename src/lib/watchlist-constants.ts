export type WatchlistEntry = { symbol: string; conid: number };

/** Watchlist symbols aligned with IBKR `conids` used for market data snapshot. */
export const WATCHLIST_ENTRIES: WatchlistEntry[] = [
  { symbol: "AAPL", conid: 265598 },
  { symbol: "MSFT", conid: 76792991 },
  { symbol: "GOOGL", conid: 4815747 },
  { symbol: "AMZN", conid: 756733 },
];

/** `conids` query must match the same `entries` passed to `<Watchlist />`. */
export function getMarketDataUrl(entries: Pick<WatchlistEntry, "conid">[]): string {
  const q = entries.map((e) => e.conid).join(",");
  return `/api/ibkr/marketdata?conids=${q}`;
}

export function conidForSymbol(
  symbol: string,
  entries: WatchlistEntry[] = WATCHLIST_ENTRIES,
): number | undefined {
  return entries.find(
    (e) => e.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.conid;
}
