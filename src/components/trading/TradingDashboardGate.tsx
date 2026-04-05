"use client";

import dynamic from "next/dynamic";

const TradingDashboard = dynamic(
  () => import("@/components/trading/TradingDashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Loading workspace…
      </div>
    ),
  },
);

export function TradingDashboardGate() {
  return <TradingDashboard />;
}
