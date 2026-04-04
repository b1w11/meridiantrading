import type {
  Rule,
  RuleConditionType,
  RulePriceData,
  RulePriceSnapshot,
} from "@/types/rules";

const MA_PERIOD = 20;
const RSI_PERIOD = 14;

/** Simple moving average of the last `period` closes. */
export function calculateMA(prices: number[], period: number): number {
  if (prices.length < period || period < 1) return Number.NaN;
  let sum = 0;
  const start = prices.length - period;
  for (let i = start; i < prices.length; i += 1) {
    sum += prices[i]!;
  }
  return sum / period;
}

/** Wilder RSI (14) from chronological close prices; returns latest RSI. */
export function calculateRSI(prices: number[], period: number = RSI_PERIOD): number {
  if (prices.length < period + 1) return Number.NaN;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    changes.push(prices[i]! - prices[i - 1]!);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i += 1) {
    const ch = changes[i]!;
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i += 1) {
    const ch = changes[i]!;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function snapshotForSymbol(
  data: RulePriceData,
  symbol: string,
): RulePriceSnapshot | undefined {
  const key = symbol.trim().toUpperCase();
  const direct = data[key];
  if (direct) return direct;
  const found = Object.keys(data).find((k) => k.toUpperCase() === key);
  return found ? data[found] : undefined;
}

function sparkPriceFromRecord(
  spark: Record<string, number>,
  symbol: string,
): number | null {
  const u = symbol.trim().toUpperCase();
  for (const [k, v] of Object.entries(spark)) {
    if (k.toUpperCase() === u && typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return null;
}

/**
 * Build {@link RulePriceData} from Yahoo spark + optional per-symbol closes.
 */
export function buildRulePriceData(
  spark: Record<string, number>,
  closesBySymbol: Record<string, number[]>,
): RulePriceData {
  const out: RulePriceData = {};
  const symbols = new Set<string>([
    ...Object.keys(spark),
    ...Object.keys(closesBySymbol),
  ]);
  for (const raw of symbols) {
    const u = raw.trim().toUpperCase();
    if (!u) continue;
    const price =
      sparkPriceFromRecord(spark, u) ??
      (() => {
        const closes = closesBySymbol[u] ?? closesBySymbol[raw];
        if (closes && closes.length > 0) {
          const last = closes[closes.length - 1];
          return typeof last === "number" && Number.isFinite(last) ? last : null;
        }
        return null;
      })();
    if (price == null) continue;
    const rawCloses = closesBySymbol[u] ?? closesBySymbol[raw];
    const closes =
      rawCloses && rawCloses.length > 0 ? rawCloses : [price];
    out[u] = { price, closes };
  }
  return out;
}

function numCondition(v: number | string): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function maCross(
  closes: number[],
  direction: "above" | "below",
  period: number,
): boolean {
  const n = closes.length;
  if (n < period + 1) return false;

  const smaAt = (endIdx: number) => {
    let sum = 0;
    for (let j = endIdx - period + 1; j <= endIdx; j += 1) {
      sum += closes[j]!;
    }
    return sum / period;
  };

  const endPrev = n - 2;
  const endCurr = n - 1;
  const maPrev = smaAt(endPrev);
  const maCurr = smaAt(endCurr);
  const cPrev = closes[endPrev]!;
  const cCurr = closes[endCurr]!;

  if (direction === "above") {
    return cPrev <= maPrev && cCurr > maCurr;
  }
  return cPrev >= maPrev && cCurr < maCurr;
}

function timeAtMatches(conditionValue: number | string, now: Date): boolean {
  const s = String(conditionValue).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const hh = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  return now.getHours() === hh && now.getMinutes() === mm;
}

function needsCloses(t: RuleConditionType): boolean {
  return (
    t === "MA_CROSS_ABOVE" ||
    t === "MA_CROSS_BELOW" ||
    t === "RSI_ABOVE" ||
    t === "RSI_BELOW"
  );
}

/**
 * Evaluate a single rule. `priceData` keys are uppercased symbols.
 */
export function evaluateRule(rule: Rule, priceData: RulePriceData): boolean {
  const type = rule.conditionType;

  if (type === "TIME_AT") {
    return timeAtMatches(rule.conditionValue, new Date());
  }

  const snap = snapshotForSymbol(priceData, rule.symbol);
  if (!snap || !Number.isFinite(snap.price)) return false;

  const { price, closes } = snap;

  switch (type) {
    case "PRICE_ABOVE": {
      const thr = numCondition(rule.conditionValue);
      return thr != null && price > thr;
    }
    case "PRICE_BELOW": {
      const thr = numCondition(rule.conditionValue);
      return thr != null && price < thr;
    }
    case "MA_CROSS_ABOVE":
      return maCross(closes, "above", MA_PERIOD);
    case "MA_CROSS_BELOW":
      return maCross(closes, "below", MA_PERIOD);
    case "RSI_ABOVE": {
      const thr = numCondition(rule.conditionValue);
      if (thr == null) return false;
      const rsi = calculateRSI(closes, RSI_PERIOD);
      return Number.isFinite(rsi) && rsi > thr;
    }
    case "RSI_BELOW": {
      const thr = numCondition(rule.conditionValue);
      if (thr == null) return false;
      const rsi = calculateRSI(closes, RSI_PERIOD);
      return Number.isFinite(rsi) && rsi < thr;
    }
    default:
      return false;
  }
}

export function ruleNeedsHistory(rule: Rule): boolean {
  return rule.enabled && needsCloses(rule.conditionType);
}
