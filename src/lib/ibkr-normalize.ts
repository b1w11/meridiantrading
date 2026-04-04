import type { PositionRow } from "@/hooks/useIBKR";

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
    const symbol = String(
      contract?.symbol ?? r.symbol ?? r.ticker ?? r.desc1 ?? "?",
    );
    const qtyRaw = num(r.position ?? r.pos ?? r.positionAmt);
    if (qtyRaw === 0 && !symbol) continue;
    const qty = Math.abs(qtyRaw);
    const side = qtyRaw < 0 ? "short" : "long";
    const avgCost = num(r.avgCost ?? r.avgPrice ?? r.averageCost);
    const unrealizedPnL = num(
      r.unrealizedPnl ?? r.unrealizedPNL ?? r.mtmPnl ?? r.fifoPnlUnrealized,
    );
    rows.push({ symbol, quantity: qty, avgCost, side, unrealizedPnL });
  }
  return rows;
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
      dayPnL += pick(summary, ["dpl", "dailyPnL", "dayPnL", "realizedToday"]);
      unrealizedPnL += pick(summary, ["upl", "unrealizedPnL", "mtm", "fifoPnlUnrealized"]);
      totalPnL += pick(summary, ["nl", "nlv", "netLiquidation", "total"]);
    }
    return { totalPnL, dayPnL, unrealizedPnL };
  }

  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    return {
      totalPnL: pick(o, ["nlv", "netLiquidation", "nl", "totalPnL"]),
      dayPnL: pick(o, ["dpl", "dailyPnL", "dayPnL"]),
      unrealizedPnL: pick(o, ["upl", "unrealizedPnL", "mtm"]),
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

function formatOrderTime(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  const s = String(raw).trim();
  if (!s) return "—";
  const n = Number(s);
  if (Number.isFinite(n) && /^-?\d+\.?\d*$/.test(s)) {
    return formatOrderTime(n);
  }
  return s;
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
      o.orderId ?? o.order_id ?? o.id ?? o.permId ?? o.ticket_id,
    );
    const contract =
      o.contract && typeof o.contract === "object"
        ? (o.contract as Record<string, unknown>)
        : undefined;
    const symbol = strVal(
      contract?.symbol ??
        o.symbol ??
        o.ticker ??
        o.description1 ??
        o.desc1 ??
        o.contractDesc ??
        o.conidex,
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
