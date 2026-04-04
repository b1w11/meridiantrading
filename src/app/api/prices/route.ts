import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const YAHOO_SPARK =
  "https://query1.finance.yahoo.com/v8/finance/spark?range=1d&interval=1d";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Yahoo often leaves `previousClose` null intraday; `chartPreviousClose` is the prior session close.
 */
function extractRefPrice(block: unknown): number | null {
  if (!block || typeof block !== "object") return null;
  const o = block as Record<string, unknown>;
  const direct = num(o.previousClose);
  if (direct != null && direct !== 0) return direct;
  const chartPrev = num(o.chartPreviousClose);
  if (chartPrev != null && chartPrev !== 0) return chartPrev;
  const closes = o.close;
  if (Array.isArray(closes) && closes.length > 0) {
    const last = num(closes[closes.length - 1]);
    if (last != null && last !== 0) return last;
  }
  return null;
}

/** Prior-session % change when Yahoo provides enough fields (backward-compat: optional). */
function extractPctChange(block: unknown): number | null {
  if (!block || typeof block !== "object") return null;
  const o = block as Record<string, unknown>;
  const meta =
    o.meta && typeof o.meta === "object"
      ? (o.meta as Record<string, unknown>)
      : o;
  const fromApi = num(meta.regularMarketChangePercent);
  if (fromApi != null && Number.isFinite(fromApi)) return fromApi;

  const closes = o.close;
  const lastClose = Array.isArray(closes)
    ? num(closes[closes.length - 1])
    : null;
  const current =
    num(meta.regularMarketPrice) ??
    num(o.regularMarketPrice) ??
    lastClose;
  const prev =
    num(meta.chartPreviousClose) ??
    num(meta.previousClose) ??
    num(o.chartPreviousClose) ??
    num(o.previousClose);
  if (
    current != null &&
    prev != null &&
    prev !== 0 &&
    Number.isFinite(current) &&
    Number.isFinite(prev)
  ) {
    return ((current - prev) / prev) * 100;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const symbols = request.nextUrl.searchParams.get("symbols")?.trim();
  if (!symbols) {
    return NextResponse.json(
      { error: "Missing required query parameter: symbols" },
      { status: 400 },
    );
  }

  const symbolList = symbols
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbolList.length === 0) {
    return NextResponse.json(
      { error: "No symbols provided" },
      { status: 400 },
    );
  }

  const url = `${YAHOO_SPARK}&symbols=${encodeURIComponent(symbols)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MeridianTrading/1.0; +https://github.com/)",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: text || `Yahoo returned ${upstream.status}` },
        { status: 502 },
      );
    }

    const json = (await upstream.json()) as Record<string, unknown>;
    const out: Record<string, number | Record<string, number>> = {};
    const pctChange: Record<string, number> = {};

    for (const sym of symbolList) {
      const upper = sym.toUpperCase();
      const block = json[sym] ?? json[upper];
      const price = extractRefPrice(block);
      if (price != null) {
        out[sym] = price;
      }
      const pct = extractPctChange(block);
      if (pct != null && Number.isFinite(pct)) {
        pctChange[sym] = pct;
      }
    }

    if (Object.keys(pctChange).length > 0) {
      out.__pctChange = pctChange;
    }

    return NextResponse.json(out);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Price request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
