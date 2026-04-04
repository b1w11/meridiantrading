"use client";

import dynamic from "next/dynamic";

const RulesDashboard = dynamic(
  () => import("@/components/trading/RulesDashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-zinc-500">
        Loading rules…
      </div>
    ),
  },
);

export function RulesDashboardGate() {
  return <RulesDashboard />;
}
