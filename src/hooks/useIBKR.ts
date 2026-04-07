export type PositionSide = "long" | "short";

export type PositionRow = {
  symbol: string;
  /** Contract id when present; used for stable row keys when the API omits symbol. */
  conid?: number;
  quantity: number;
  avgCost: number;
  side: PositionSide;
  unrealizedPnL: number;
};
