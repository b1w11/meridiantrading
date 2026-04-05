import type { WatchlistEntry } from "@/lib/watchlist-constants";

function asRowArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.secdef)) return o.secdef;
    if (Array.isArray(o.symbols)) return o.symbols;
    if (Array.isArray(o.results)) return o.results;
  }
  return [];
}

/** First contract row from IBKR `/iserver/secdef/search` JSON (shape varies by gateway version). */
export function parseFirstSearchConid(data: unknown): WatchlistEntry | null {
  for (const item of asRowArray(data)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const conid = Number(o.conid);
    const symbol = String(o.symbol ?? o.ticker ?? "").trim();
    if (!Number.isFinite(conid) || conid <= 0 || !symbol) continue;
    return { symbol: symbol.toUpperCase(), conid };
  }
  return null;
}
