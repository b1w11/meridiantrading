import { type NextRequest, NextResponse } from "next/server";

import type { ChartOHLCBar } from "@/lib/chart-history";

export const dynamic = "force-dynamic";

const TIMEFRAME_PRESETS: Record<
  string,
  { interval: string; range: string }
> = {
  "1D": { interval: "5m", range: "1d" },
  "1W": { interval: "1h", range: "5d" },
  "1M": { interval: "1d", range: "1mo" },
  "3M": { interval: "1d", range: "3mo" },
  "1Y": { interval: "1d", range: "1y" },
};

function parseYahooChart(json: unknown): ChartOHLCBar[] {
  if (!json || typeof json !== "object") return [];
  const chart = (json as Record<string, unknown>).chart;
  if (!chart || typeof chart !== "object") return [];
  const c = chart as Record<string, unknown>;
  if (c.error) return [];
  const result = c.result;
  if (!Array.isArray(result) || result.length === 0) return [];

  const first = result[0] as Record<string, unknown>;
  const timestamps = first.timestamp;
  if (!Array.isArray(timestamps)) return [];

  const indicators = first.indicators as Record<string, unknown> | undefined;
  const quotes = indicators?.quote;
  if (!Array.isArray(quotes) || quotes.length === 0) return [];
  const q = quotes[0] as Record<string, unknown>;
  const opens = q.open;
  const highs = q.high;
  const lows = q.low;
  const closes = q.close;
  if (
    !Array.isArray(opens) ||
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes)
  ) {
    return [];
  }

  const out: ChartOHLCBar[] = [];
  const n = timestamps.length;
  for (let i = 0; i < n; i += 1) {
    const t = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (
      typeof t !== "number" ||
      typeof o !== "number" ||
      typeof h !== "number" ||
      typeof l !== "number" ||
      typeof c !== "number" ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    ) {
      continue;
    }
    out.push({
      time: t,
      open: o,
      high: h,
      low: l,
      close: c,
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json(
      { error: "Missing required query parameter: symbol" },
      { status: 400 },
    );
  }

  const intervalParam = request.nextUrl.searchParams.get("interval")?.trim();
  const rangeParam = request.nextUrl.searchParams.get("range")?.trim();
  const timeframe =
    request.nextUrl.searchParams.get("timeframe")?.trim().toUpperCase() ??
    "1D";

  let interval: string;
  let range: string;

  if (intervalParam && rangeParam) {
    interval = intervalParam;
    range = rangeParam;
  } else if (rangeParam && !intervalParam) {
    const r = rangeParam.toLowerCase();
    const byRange: Record<string, { interval: string; range: string }> = {
      "1d": { interval: "5m", range: "1d" },
      "5d": { interval: "1h", range: "5d" },
      "1mo": { interval: "1d", range: "1mo" },
      "3mo": { interval: "1d", range: "3mo" },
      "1y": { interval: "1d", range: "1y" },
    };
    const hit = byRange[r];
    if (!hit) {
      return NextResponse.json(
        { error: `Unsupported range: ${rangeParam}` },
        { status: 400 },
      );
    }
    interval = hit.interval;
    range = hit.range;
  } else {
    const preset = TIMEFRAME_PRESETS[timeframe];
    if (!preset) {
      return NextResponse.json(
        {
          error: `Invalid timeframe. Use one of: ${Object.keys(TIMEFRAME_PRESETS).join(", ")}`,
        },
        { status: 400 },
      );
    }
    interval = preset.interval;
    range = preset.range;
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; MeridianTrading/1.0; +https://github.com/)",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: text || `Yahoo returned ${upstream.status}` },
        { status: 502 },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON from Yahoo" },
        { status: 502 },
      );
    }

    const bars = parseYahooChart(json);
    return NextResponse.json(bars);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chart request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
