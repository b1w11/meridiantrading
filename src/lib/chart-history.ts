/** OHLC bar for lightweight-charts (`time` = Unix seconds, `UTCTimestamp`). */
export type ChartOHLCBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export const CHART_TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y"] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];
