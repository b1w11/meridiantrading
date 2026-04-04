export type RuleConditionType =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "MA_CROSS_ABOVE"
  | "MA_CROSS_BELOW"
  | "RSI_ABOVE"
  | "RSI_BELOW"
  | "TIME_AT";

export type RuleAction = {
  side: "long" | "short";
  orderType: "MKT" | "LMT";
  quantity: number;
  price?: number;
};

export type Rule = {
  id: string;
  name: string;
  symbol: string;
  conid: number;
  conditionType: RuleConditionType;
  conditionValue: number | string;
  action: RuleAction;
  enabled: boolean;
  lastTriggered?: string;
  createdAt: string;
};

export type RuleEngineStatus = {
  running: boolean;
  killSwitch: boolean;
  lastChecked: string;
  activeRules: number;
};

/** Latest price plus chronological closes (oldest first) for MA/RSI. */
export type RulePriceSnapshot = {
  price: number;
  closes: number[];
};

export type RulePriceData = Record<string, RulePriceSnapshot>;

export type EngineLogActionTaken = "order_placed" | "skipped" | "none";

export type EngineLogEntry = {
  id: string;
  timestamp: string;
  ruleId: string;
  ruleName: string;
  conditionMet: boolean;
  actionTaken: EngineLogActionTaken;
  reason?: string;
};

export type OrderAttemptEntry = {
  id: string;
  timestamp: string;
  ruleId: string;
  ruleName: string;
  outcome: "placed" | "skipped" | "failed";
  reason: string;
};
