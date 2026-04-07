import type { PositionRow } from "@/hooks/useIBKR";

import { isLikelyYahooTicker } from "@/lib/symbol-validation";

export type PnlSummary = {
  totalPnL: number;
  dayPnL: number;
  unrealizedPnL: number;
};

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pick(
  o: Record<string, unknown>,
  keys: string[],
): number {
  for (const k of keys) {
    if (k in o && o[k] != null) return num(o[k]);
  }
  return 0;
}

function pickTrimmedString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) return t;
  }
  return "";
}

/** Normalize CP Web API portfolio positions payload. */
export function normalizePositions(data: unknown): PositionRow[] {
  if (!Array.isArray(data)) return [];
  const rows: PositionRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const contract =
      r.contract && typeof r.contract === "object"
        ? (r.contract as Record<string, unknown>)
        : undefined;
    const conidRaw = num(r.conid ?? contract?.conid);
    const conid =
      Number.isFinite(conidRaw) && conidRaw !== 0 ? conidRaw : undefined;

    let symbol = pickTrimmedString(
      contract?.symbol,
      contract?.localSymbol,
      r.localSymbol,
      r.symbol,
      r.ticker,
      r.und_sym,
    );
    if (!symbol) {
      const d1 = pickTrimmedString(r.desc1);
      if (d1 && isLikelyYahooTicker(d1)) symbol = d1;
    }
    if (!symbol && conid != null) symbol = `#${conid}`;
    if (!symbol) continue;

    const qtyRaw = num(r.position ?? r.pos ?? r.positionAmt);
    const qty = Math.abs(qtyRaw);
    if (qty < 1e-12) continue;
    const side = qtyRaw < 0 ? "short" : "long";
    const avgCost = num(r.avgCost ?? r.avgPrice ?? r.averageCost);
    const unrealizedPnL = num(
      r.unrealizedPnl ?? r.unrealizedPNL ?? r.mtmPnl ?? r.fifoPnlUnrealized,
    );
    rows.push({
      symbol,
      ...(conid != null ? { conid } : {}),
      quantity: qty,
      avgCost,
      side,
      unrealizedPnL,
    });
  }
  return rows;
}

const PNL_UPL_KEYS = [
  "upl",
  "unrealizedPnL",
  "unrealized_pnl",
  "mtm",
  "fifoPnlUnrealized",
] as const;

const PNL_DPL_KEYS = [
  "dpl",
  "dailyPnL",
  "dayPnL",
  "realizedToday",
] as const;

const PNL_NL_KEYS = [
  "nl",
  "nlv",
  "netLiquidation",
  "total",
  "totalPnL",
] as const;

/** CP `/iserver/account/pnl/partitioned` often returns `{ upnl: { [acctId]: { upl, dpl, nl, ... } } }`. */
function sumPartitionedUpnlMap(
  map: Record<string, unknown>,
): { dayPnL: number; unrealizedPnL: number; totalPnL: number; segments: number } {
  let dayPnL = 0;
  let unrealizedPnL = 0;
  let totalPnL = 0;
  let segments = 0;
  for (const v of Object.values(map)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const seg = v as Record<string, unknown>;
    dayPnL += pick(seg, [...PNL_DPL_KEYS]);
    unrealizedPnL += pick(seg, [...PNL_UPL_KEYS]);
    totalPnL += pick(seg, [...PNL_NL_KEYS]);
    segments += 1;
  }
  return { dayPnL, unrealizedPnL, totalPnL, segments };
}

/** Normalize partitioned P&L (array of segments with `summary` or flat object). */
export function normalizePnl(data: unknown): PnlSummary {
  const zero: PnlSummary = { totalPnL: 0, dayPnL: 0, unrealizedPnL: 0 };
  if (data == null) return zero;

  if (Array.isArray(data)) {
    let dayPnL = 0;
    let unrealizedPnL = 0;
    let totalPnL = 0;
    for (const seg of data) {
      if (!seg || typeof seg !== "object") continue;
      const s = seg as Record<string, unknown>;
      const summary =
        s.summary && typeof s.summary === "object"
          ? (s.summary as Record<string, unknown>)
          : s;
      dayPnL += pick(summary, [...PNL_DPL_KEYS]);
      unrealizedPnL += pick(summary, [...PNL_UPL_KEYS]);
      totalPnL += pick(summary, [...PNL_NL_KEYS]);
    }
    return { totalPnL, dayPnL, unrealizedPnL };
  }

  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    const upnl = o.upnl;
    if (upnl && typeof upnl === "object" && !Array.isArray(upnl)) {
      const nested = sumPartitionedUpnlMap(upnl as Record<string, unknown>);
      if (nested.segments > 0) {
        return {
          totalPnL:
            nested.totalPnL || pick(o, [...PNL_NL_KEYS]),
          dayPnL:
            nested.dayPnL || pick(o, ["dpl", "dailyPnL", "dayPnL"]),
          unrealizedPnL: nested.unrealizedPnL,
        };
      }
    }
    return {
      totalPnL: pick(o, [...PNL_NL_KEYS]),
      dayPnL: pick(o, ["dpl", "dailyPnL", "dayPnL"]),
      unrealizedPnL: pick(o, [...PNL_UPL_KEYS]),
    };
  }

  return zero;
}

/** Map conid → last trade (field `31` in snapshot ticks). */
export function snapshotConidToLast(data: unknown): Map<number, number> {
  const m = new Map<number, number>();
  if (!Array.isArray(data)) return m;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const conid = num(o.conid);
    if (!Number.isFinite(conid) || conid === 0) continue;
    const last = o["31"] ?? o["7295"] ?? o.lastPrice ?? o.mark;
    const n = num(last);
    if (Number.isFinite(n) && n !== 0) m.set(conid, n);
  }
  return m;
}

export function lastPricesBySymbol(
  snapshot: unknown,
  entries: { symbol: string; conid: number }[],
): Record<string, number | null> {
  const byConid = snapshotConidToLast(snapshot);
  const out: Record<string, number | null> = {};
  for (const { symbol, conid } of entries) {
    const v = byConid.get(conid);
    out[symbol] = v != null && Number.isFinite(v) ? v : null;
  }
  return out;
}

function isUsableLastPrice(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v !== 0;
}

/**
 * When IBKR returns 0 or no tick, keep the last known good price per symbol.
 */
export function mergeStickyLastPrices(
  fresh: Record<string, number | null>,
  entries: { symbol: string }[],
  previousStash: Record<string, number>,
): { merged: Record<string, number | null>; stash: Record<string, number> } {
  const stash: Record<string, number> = {};
  const merged: Record<string, number | null> = {};

  for (const { symbol } of entries) {
    const v = fresh[symbol];
    if (isUsableLastPrice(v)) {
      merged[symbol] = v;
      stash[symbol] = v;
    } else if (isUsableLastPrice(previousStash[symbol])) {
      merged[symbol] = previousStash[symbol];
      stash[symbol] = previousStash[symbol];
    } else {
      merged[symbol] = null;
    }
  }

  return { merged, stash };
}

export type LiveOrderRow = {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  status: string;
  /** Display string for order time (from gateway when available). */
  orderTime: string;
};

function strVal(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function formatOrderInstant(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * CP Web API often sends `orderTime` as compact digits `YYMMDDhhmmss` (12 chars) or
 * `YYYYMMDDHHmmss` (14 chars), not Unix epoch. Those components are **UTC**; using the local
 * `Date(y,m,d,h,m,s)` constructor shifts them (e.g. −2h in CEST vs UTC).
 */
function parseCompactOrderDigits(intStr: string): Date | null {
  const s = intStr.replace(/^-/, "");
  if (!/^\d+$/.test(s)) return null;

  if (s.length === 12) {
    const yy = Number(s.slice(0, 2));
    const month = Number(s.slice(2, 4)) - 1;
    const day = Number(s.slice(4, 6));
    const h = Number(s.slice(6, 8));
    const m = Number(s.slice(8, 10));
    const sec = Number(s.slice(10, 12));
    if (
      !Number.isFinite(yy) ||
      month < 0 ||
      month > 11 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
    const ms = Date.UTC(fullYear, month, day, h, m, sec);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (s.length === 14) {
    const fullYear = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6)) - 1;
    const day = Number(s.slice(6, 8));
    const h = Number(s.slice(8, 10));
    const m = Number(s.slice(10, 12));
    const sec = Number(s.slice(12, 14));
    if (
      fullYear < 1970 ||
      fullYear > 2100 ||
      month < 0 ||
      month > 11 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }
    const ms = Date.UTC(fullYear, month, day, h, m, sec);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatOrderTime(raw: unknown): string {
  if (raw == null || raw === "") return "—";

  const tryInstant = (d: Date): string | null =>
    Number.isNaN(d.getTime()) ? null : formatOrderInstant(d);

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = raw;
    const intStr = String(Math.trunc(Math.abs(n)));
    const compact = parseCompactOrderDigits(intStr);
    if (compact) {
      const s = tryInstant(compact);
      if (s) return s;
    }
    if (n >= 1e12 && n < 1e15) {
      const s = tryInstant(new Date(n));
      if (s) return s;
    }
    if (n >= 1_000_000_000 && n < 1e12) {
      const s = tryInstant(new Date(n * 1000));
      if (s) return s;
    }
    return "—";
  }

  const str = String(raw).trim();
  if (!str) return "—";

  const compactFromStr = parseCompactOrderDigits(str.replace(/\s+/g, ""));
  if (compactFromStr) {
    const s = tryInstant(compactFromStr);
    if (s) return s;
  }

  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) {
    const s = tryInstant(new Date(parsed));
    if (s) return s;
  }

  const n = Number(str);
  if (Number.isFinite(n) && /^-?\d+(?:\.\d+)?$/.test(str)) {
    return formatOrderTime(n);
  }
  return str;
}

function unwrapOrderList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.orders)) return o.orders;
    if (Array.isArray(o.liveOrders)) return o.liveOrders;
    if (Array.isArray(o.snapshot)) return o.snapshot;
  }
  return [];
}

/** Normalize CP Web API live / open orders list. */
export function normalizeLiveOrders(data: unknown): LiveOrderRow[] {
  const rows = unwrapOrderList(data);
  const out: LiveOrderRow[] = [];
  let i = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const orderId = strVal(
      o.orderId ??
        o.order_id ??
        o.id ??
        o.ticket ??
        o.permId ??
        o.ticket_id,
    );
    const contract =
      o.contract && typeof o.contract === "object"
        ? (o.contract as Record<string, unknown>)
        : undefined;
    /** Avoid `conidex` — it is a composite id, not a display symbol (wrong labels vs conid). */
    const symbol = strVal(
      contract?.symbol ??
        contract?.localSymbol ??
        o.symbol ??
        o.ticker ??
        o.description1 ??
        o.desc1 ??
        o.contractDesc,
    );
    const sideRaw = strVal(o.side).toUpperCase();
    const side =
      sideRaw === "BUY"
        ? "BUY"
        : sideRaw === "SELL"
          ? "SELL"
          : sideRaw || "—";
    const orderType = strVal(
      o.orderType ?? o.order_type ?? o.origOrderType ?? o.secType ?? "—",
    );
    const quantity = num(
      o.totalSize ??
        o.quantity ??
        o.size ??
        o.totalQuantity ??
        o.remainingQuantity,
    );
    const status = strVal(
      o.status ?? o.order_status ?? o.orderStatus ?? o.orderState ?? "—",
    );
    const timeRaw =
      o.orderTime ??
      o.order_time ??
      o.time ??
      o.submitTime ??
      o.lastExecutionTime ??
      o.lastExecutionTime_r ??
      o.lastModified ??
      o.lastModifiedTime ??
      o.order_ccp_status_time ??
      o.order_ccp_status_time_r;
    const orderTime = formatOrderTime(timeRaw);
    out.push({
      orderId: orderId || `—${i}`,
      symbol: symbol || "—",
      side,
      orderType: orderType || "—",
      quantity,
      status: status || "—",
      orderTime,
    });
    i += 1;
  }
  return out;
}
