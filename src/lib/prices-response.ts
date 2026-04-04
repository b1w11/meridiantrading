/**
 * Normalizes `/api/prices` JSON: numeric symbol keys are last prices;
 * optional `__pctChange` holds prior-session % change per symbol when available.
 */
export function parsePricesResponse(data: unknown): {
  prices: Record<string, number>;
  pctChange: Record<string, number>;
} {
  const prices: Record<string, number> = {};
  const pctChange: Record<string, number> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { prices, pctChange };
  }
  const o = data as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === "__pctChange" && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sym, p] of Object.entries(v as Record<string, unknown>)) {
        if (typeof p === "number" && Number.isFinite(p)) {
          pctChange[sym] = p;
        }
      }
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      prices[k] = v;
    }
  }
  return { prices, pctChange };
}
