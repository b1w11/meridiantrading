export type PositionSide = "long" | "short";

export type PositionRow = {
  symbol: string;
  quantity: number;
  avgCost: number;
  side: PositionSide;
  unrealizedPnL: number;
};
