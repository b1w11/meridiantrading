import type {
  Rule,
  RuleAction,
  RuleConditionType,
} from "@/types/rules";

const CONDITION_TYPES: RuleConditionType[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "MA_CROSS_ABOVE",
  "MA_CROSS_BELOW",
  "RSI_ABOVE",
  "RSI_BELOW",
  "TIME_AT",
];

function isRuleAction(x: unknown): x is RuleAction {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.side !== "long" && o.side !== "short") return false;
  if (o.orderType !== "MKT" && o.orderType !== "LMT") return false;
  if (typeof o.quantity !== "number" || !Number.isFinite(o.quantity) || o.quantity <= 0) {
    return false;
  }
  if (o.price !== undefined && o.price !== null) {
    if (typeof o.price !== "number" || !Number.isFinite(o.price)) return false;
  }
  return true;
}

/**
 * Validate an unknown value as a {@link Rule}. Returns human-readable errors.
 */
export function validateRulePayload(input: unknown): { ok: true; rule: Rule } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Root value must be a JSON object"] };
  }
  const o = input as Record<string, unknown>;

  if (typeof o.id !== "string" || !o.id.trim()) errors.push("id must be a non-empty string");
  if (typeof o.name !== "string" || !o.name.trim()) errors.push("name must be a non-empty string");
  if (typeof o.symbol !== "string" || !o.symbol.trim()) errors.push("symbol must be a non-empty string");
  if (typeof o.conid !== "number" || !Number.isFinite(o.conid) || o.conid <= 0) {
    errors.push("conid must be a positive number");
  }
  if (!CONDITION_TYPES.includes(o.conditionType as RuleConditionType)) {
    errors.push(`conditionType must be one of: ${CONDITION_TYPES.join(", ")}`);
  }
  if (o.conditionValue === undefined || o.conditionValue === null) {
    errors.push("conditionValue is required");
  } else if (
    typeof o.conditionValue !== "number" &&
    typeof o.conditionValue !== "string"
  ) {
    errors.push("conditionValue must be a number or string");
  }
  if (!isRuleAction(o.action)) {
    errors.push(
      'action must be { side: "long"|"short", orderType: "MKT"|"LMT", quantity: number, price?: number }',
    );
  } else if (o.action.orderType === "LMT") {
    if (typeof o.action.price !== "number" || !Number.isFinite(o.action.price)) {
      errors.push("action.price is required for LMT orders");
    }
  }
  if (typeof o.enabled !== "boolean") errors.push("enabled must be boolean");
  if (typeof o.createdAt !== "string" || !o.createdAt.trim()) {
    errors.push("createdAt must be an ISO date string");
  }
  if (o.lastTriggered !== undefined && o.lastTriggered !== null) {
    if (typeof o.lastTriggered !== "string") {
      errors.push("lastTriggered must be a string when present");
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const rule: Rule = {
    id: String(o.id).trim(),
    name: String(o.name).trim(),
    symbol: String(o.symbol).trim(),
    conid: o.conid as number,
    conditionType: o.conditionType as RuleConditionType,
    conditionValue: o.conditionValue as number | string,
    action: o.action as RuleAction,
    enabled: o.enabled as boolean,
    createdAt: String(o.createdAt),
    ...(typeof o.lastTriggered === "string" ? { lastTriggered: o.lastTriggered } : {}),
  };

  return { ok: true, rule };
}
