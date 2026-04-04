import { create } from "zustand";

export type ChartType = "candlestick" | "line";

type TradingState = {
  activeTicker: string;
  chartType: ChartType;
  setActiveTicker: (ticker: string) => void;
  setChartType: (t: ChartType) => void;
};

export const useTradingStore = create<TradingState>((set) => ({
  activeTicker: "AAPL",
  chartType: "candlestick",
  setActiveTicker: (activeTicker) => set({ activeTicker }),
  setChartType: (chartType) => set({ chartType }),
}));
