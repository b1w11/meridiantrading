/** True if the string is safe to pass to Yahoo Finance spark / similar ticker APIs. */
export function isLikelyYahooTicker(symbol: string): boolean {
  const s = symbol.trim();
  if (s.length < 1 || s.length > 32) return false;
  if (s === "?") return false;
  if (s.startsWith("#")) return false;
  return /^[A-Za-z0-9.\-\^]+$/.test(s);
}
