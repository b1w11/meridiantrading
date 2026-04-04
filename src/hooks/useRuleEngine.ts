"use client";

import { useEffect } from "react";

import {
  buildRulePriceData,
  evaluateRule,
  ruleNeedsHistory,
} from "@/lib/rule-engine";
import { useRulesStore } from "@/store/rules";
import type { Rule } from "@/types/rules";

const TICK_MS = 10_000;
const RULE_COOLDOWN_MS = 60_000;

/**
 * Whether an order may be sent for this rule: never fired, or last fire was more
 * than {@link RULE_COOLDOWN_MS} ms ago (use a fresh `rule` from the store).
 */
function ruleCooldownAllowsFire(rule: Rule, now: number): boolean {
  const raw = rule.lastTriggered;
  if (raw == null || String(raw).trim() === "") {
    return true;
  }
  const t = Date.parse(String(raw));
  if (!Number.isFinite(t)) {
    return false;
  }
  return now - t > RULE_COOLDOWN_MS;
}

function symbolsFromRules(rules: Rule[]): string[] {
  const set = new Set<string>();
  for (const r of rules) {
    if (r.enabled) set.add(r.symbol.trim().toUpperCase());
  }
  return [...set];
}

async function fetchSpark(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const res = await fetch(
    `/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`,
  );
  const j = (await res.json()) as { error?: string } & Record<string, number>;
  if (!res.ok) {
    throw new Error(typeof j.error === "string" ? j.error : "Price fetch failed");
  }
  return j;
}

async function fetchCloses(symbol: string): Promise<number[]> {
  const res = await fetch(
    `/api/prices/history?symbol=${encodeURIComponent(symbol)}&range=1mo&interval=1d`,
  );
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map((b: { close?: number }) => b.close)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
}

/**
 * Polls prices every 10s, evaluates enabled rules, places orders with guardrails.
 * Mount once (e.g. via {@link RuleEngineRunner}) so automation runs app-wide.
 */
export function useRuleEngine(): void {
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const {
        rules,
        engineStatus,
        appendEngineLog,
        appendOrderAttemptLog,
        updateRule,
        syncActiveRulesCount,
        setEngineStatus,
        canPlaceOrderThisHour,
        recordOrderPlacedThisHour,
      } = useRulesStore.getState();

      if (!engineStatus.running) return;

      const enabledRules = rules.filter((r) => r.enabled);
      syncActiveRulesCount();

      const now = Date.now();
      const iso = new Date(now).toISOString();

      if (enabledRules.length === 0) {
        setEngineStatus({
          ...useRulesStore.getState().engineStatus,
          lastChecked: iso,
        });
        return;
      }

      const symbols = symbolsFromRules(enabledRules);
      let spark: Record<string, number>;
      try {
        spark = await fetchSpark(symbols);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Price fetch failed";
        appendEngineLog({
          timestamp: iso,
          ruleId: "—",
          ruleName: "Engine",
          conditionMet: false,
          actionTaken: "none",
          reason: msg,
        });
        setEngineStatus({
          ...useRulesStore.getState().engineStatus,
          lastChecked: iso,
        });
        return;
      }

      if (cancelled) return;

      const needHistory = new Set<string>();
      for (const r of enabledRules) {
        if (ruleNeedsHistory(r)) {
          needHistory.add(r.symbol.trim().toUpperCase());
        }
      }

      const closesBySymbol: Record<string, number[]> = {};
      await Promise.all(
        [...needHistory].map(async (sym) => {
          const closes = await fetchCloses(sym);
          closesBySymbol[sym] = closes.length > 0 ? closes : [];
        }),
      );

      if (cancelled) return;

      const priceData = buildRulePriceData(spark, closesBySymbol);

      const killSwitch = useRulesStore.getState().engineStatus.killSwitch;

      for (const rule of enabledRules) {
        let met = false;
        try {
          met = evaluateRule(rule, priceData);
        } catch {
          met = false;
        }

        if (!met) {
          appendEngineLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            conditionMet: false,
            actionTaken: "none",
          });
          continue;
        }

        if (killSwitch) {
          const reason = "Kill switch active — automated trading halted";
          appendEngineLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            conditionMet: true,
            actionTaken: "skipped",
            reason,
          });
          appendOrderAttemptLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            outcome: "skipped",
            reason,
          });
          continue;
        }

        const { action } = rule;
        if (action.orderType === "LMT") {
          if (action.price == null || !Number.isFinite(action.price)) {
            const reason = "Limit order requires a valid action.price";
            appendEngineLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              conditionMet: true,
              actionTaken: "skipped",
              reason,
            });
            appendOrderAttemptLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              outcome: "skipped",
              reason,
            });
            continue;
          }
        }

        const beforePost = Date.now();
        const liveRule =
          useRulesStore.getState().rules.find((r) => r.id === rule.id) ?? rule;

        if (!ruleCooldownAllowsFire(liveRule, beforePost)) {
          const reason =
            "Cooldown: last order for this rule was within the last 60 seconds";
          appendEngineLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            conditionMet: true,
            actionTaken: "skipped",
            reason,
          });
          appendOrderAttemptLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            outcome: "skipped",
            reason,
          });
          continue;
        }

        if (!useRulesStore.getState().canPlaceOrderThisHour(beforePost)) {
          const reason =
            "Global limit: max 3 automation orders per rolling hour (all rules)";
          appendEngineLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            conditionMet: true,
            actionTaken: "skipped",
            reason,
          });
          appendOrderAttemptLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            outcome: "skipped",
            reason,
          });
          continue;
        }

        const body: Record<string, unknown> = {
          conid: rule.conid,
          orderType: action.orderType,
          side: action.side,
          quantity: action.quantity,
          tif: "DAY",
        };
        if (action.orderType === "LMT" && action.price != null) {
          body.price = action.price;
        }

        try {
          const res = await fetch("/api/ibkr/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const text = await res.text();
          if (res.ok) {
            const afterOk = Date.now();
            recordOrderPlacedThisHour(afterOk);
            updateRule(rule.id, { lastTriggered: new Date().toISOString() });
            appendEngineLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              conditionMet: true,
              actionTaken: "order_placed",
            });
            appendOrderAttemptLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              outcome: "placed",
              reason: `POST OK (${res.status}) ${text.slice(0, 120)}`,
            });
          } else {
            const reason = `Order rejected: HTTP ${res.status} ${text.slice(0, 200)}`;
            appendEngineLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              conditionMet: true,
              actionTaken: "skipped",
              reason,
            });
            appendOrderAttemptLog({
              timestamp: new Date().toISOString(),
              ruleId: rule.id,
              ruleName: rule.name,
              outcome: "failed",
              reason,
            });
          }
        } catch (e) {
          const reason =
            e instanceof Error ? e.message : "Network error posting order";
          appendEngineLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            conditionMet: true,
            actionTaken: "skipped",
            reason,
          });
          appendOrderAttemptLog({
            timestamp: new Date().toISOString(),
            ruleId: rule.id,
            ruleName: rule.name,
            outcome: "failed",
            reason,
          });
        }
      }

      setEngineStatus({
        ...useRulesStore.getState().engineStatus,
        lastChecked: new Date().toISOString(),
      });
    };

    const id = window.setInterval(() => {
      void tick();
    }, TICK_MS);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
}
