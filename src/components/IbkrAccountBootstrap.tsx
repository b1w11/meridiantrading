"use client";

import { useEffect } from "react";

import { useTradingStore } from "@/store/trading";

/** Fetches IBKR account id once from the server and stores it in the trading store. */
export function IbkrAccountBootstrap() {
  const setIbkrAccountFromMe = useTradingStore((s) => s.setIbkrAccountFromMe);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ibkr/me");
        if (!res.ok) {
          if (!cancelled) setIbkrAccountFromMe(undefined);
          return;
        }
        const data = (await res.json()) as { accountId?: unknown };
        if (cancelled) return;
        const raw = data.accountId;
        const id =
          typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
        setIbkrAccountFromMe(id);
      } catch {
        if (!cancelled) setIbkrAccountFromMe(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setIbkrAccountFromMe]);

  return null;
}
