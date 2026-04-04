/** Display names for watchlist rows (symbol → company). */
export const WATCHLIST_COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.",
};

export function companyNameForSymbol(symbol: string): string {
  return WATCHLIST_COMPANY_NAMES[symbol.toUpperCase()] ?? symbol;
}
