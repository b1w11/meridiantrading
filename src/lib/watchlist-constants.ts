/** Watchlist symbols aligned with IBKR `conids` used for market data snapshot. */
export const WATCHLIST_ENTRIES: { symbol: string; conid: number }[] = [
  { symbol: "AAPL", conid: 265598 },
  { symbol: "MSFT", conid: 76792991 },
  { symbol: "GOOGL", conid: 4815747 },
  { symbol: "AMZN", conid: 756733 },
];

/** `conids` query must match the same `entries` passed to `<Watchlist />`. */
export function getMarketDataUrl(entries: { conid: number }[]): string {
  const q = entries.map((e) => e.conid).join(",");
  return `/api/ibkr/marketdata?conids=${q}`;
}

export function conidForSymbol(
  symbol: string,
  entries: { symbol: string; conid: number }[] = WATCHLIST_ENTRIES,
): number | undefined {
  return entries.find(
    (e) => e.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.conid;
}
