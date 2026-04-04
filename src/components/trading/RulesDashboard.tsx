"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Topbar } from "@/components/trading/Topbar";
import { formatDateTimeStable } from "@/lib/format-display";
import { normalizeLiveOrders } from "@/lib/ibkr-normalize";
import { buildRulePriceData, ruleNeedsHistory } from "@/lib/rule-engine";
import { cancelAllCancellableOrders } from "@/lib/open-orders";
import { validateRulePayload } from "@/lib/rules-validate";
import { useRulesStore } from "@/store/rules";
import type { Rule, RuleConditionType } from "@/types/rules";

const CONDITION_OPTIONS: { value: RuleConditionType; label: string }[] = [
  { value: "PRICE_ABOVE", label: "Price above" },
  { value: "PRICE_BELOW", label: "Price below" },
  { value: "MA_CROSS_ABOVE", label: "MA cross above (20)" },
  { value: "MA_CROSS_BELOW", label: "MA cross below (20)" },
  { value: "RSI_ABOVE", label: "RSI above" },
  { value: "RSI_BELOW", label: "RSI below" },
  { value: "TIME_AT", label: "Time at (HH:MM)" },
];

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function conditionSummary(r: Rule): string {
  const v = r.conditionValue;
  switch (r.conditionType) {
    case "PRICE_ABOVE":
      return `Price above ${v}`;
    case "PRICE_BELOW":
      return `Price below ${v}`;
    case "MA_CROSS_ABOVE":
      return "20 MA cross above";
    case "MA_CROSS_BELOW":
      return "20 MA cross below";
    case "RSI_ABOVE":
      return `RSI above ${v}`;
    case "RSI_BELOW":
      return `RSI below ${v}`;
    case "TIME_AT":
      return `Time at ${v}`;
    default:
      return String(r.conditionType);
  }
}

function actionSummary(r: Rule): string {
  const a = r.action;
  const side = a.side === "long" ? "Buy" : "Sell";
  const px = a.price != null ? ` @ ${a.price}` : "";
  return `${side} ${a.quantity} ${r.symbol} ${a.orderType}${px}`;
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

function symbolsFromRules(rules: Rule[]): string[] {
  const set = new Set<string>();
  for (const r of rules) {
    if (r.enabled) set.add(r.symbol.trim().toUpperCase());
  }
  return [...set];
}

type BuilderForm = {
  name: string;
  symbol: string;
  conid: string;
  conditionType: RuleConditionType;
  conditionValue: string;
  side: "long" | "short";
  orderType: "MKT" | "LMT";
  quantity: string;
  price: string;
  enabled: boolean;
};

const emptyForm: BuilderForm = {
  name: "",
  symbol: "",
  conid: "",
  conditionType: "PRICE_ABOVE",
  conditionValue: "",
  side: "long",
  orderType: "MKT",
  quantity: "1",
  price: "",
  enabled: true,
};

function ruleToForm(r: Rule): BuilderForm {
  return {
    name: r.name,
    symbol: r.symbol,
    conid: String(r.conid),
    conditionType: r.conditionType,
    conditionValue:
      typeof r.conditionValue === "number"
        ? String(r.conditionValue)
        : String(r.conditionValue),
    side: r.action.side,
    orderType: r.action.orderType,
    quantity: String(r.action.quantity),
    price:
      r.action.price != null && Number.isFinite(r.action.price)
        ? String(r.action.price)
        : "",
    enabled: r.enabled,
  };
}

function formToRule(
  form: BuilderForm,
  id: string | null,
  createdAt?: string,
): { rule: Rule } | { error: string } {
  const conid = parseInt(form.conid.trim(), 10);
  if (!Number.isFinite(conid) || conid <= 0) {
    return { error: "Contract ID must be a positive number." };
  }
  const qty = parseFloat(form.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: "Quantity must be a positive number." };
  }

  let conditionValue: number | string = form.conditionValue.trim();
  if (
    form.conditionType !== "TIME_AT" &&
    form.conditionType !== "MA_CROSS_ABOVE" &&
    form.conditionType !== "MA_CROSS_BELOW"
  ) {
    const n = parseFloat(form.conditionValue);
    if (!Number.isFinite(n)) {
      return { error: "Condition value must be a valid number." };
    }
    conditionValue = n;
  }

  if (form.conditionType === "TIME_AT") {
    if (!/^\d{1,2}:\d{2}$/.test(String(conditionValue))) {
      return { error: "Time must be HH:MM (24h)." };
    }
  }

  let price: number | undefined;
  if (form.orderType === "LMT") {
    const p = parseFloat(form.price);
    if (!Number.isFinite(p)) {
      return { error: "Limit orders require a limit price." };
    }
    price = p;
  }

  const rule: Rule = {
    id: id ?? newId(),
    name: form.name.trim() || "Untitled rule",
    symbol: form.symbol.trim() || "—",
    conid,
    conditionType: form.conditionType,
    conditionValue,
    action: {
      side: form.side,
      orderType: form.orderType,
      quantity: qty,
      ...(price != null ? { price } : {}),
    },
    enabled: form.enabled,
    createdAt: createdAt ?? new Date().toISOString(),
  };

  return { rule };
}

export default function RulesDashboard() {
  const rules = useRulesStore((s) => s.rules);
  const engineStatus = useRulesStore((s) => s.engineStatus);
  const engineLog = useRulesStore((s) => s.engineLog);
  const orderAttemptLog = useRulesStore((s) => s.orderAttemptLog);
  const addRule = useRulesStore((s) => s.addRule);
  const updateRule = useRulesStore((s) => s.updateRule);
  const deleteRule = useRulesStore((s) => s.deleteRule);
  const toggleRule = useRulesStore((s) => s.toggleRule);
  const setKillSwitch = useRulesStore((s) => s.setKillSwitch);
  const setEngineStatus = useRulesStore((s) => s.setEngineStatus);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<"builder" | "code">("builder");
  const [form, setForm] = useState<BuilderForm>(emptyForm);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [serverEvalResult, setServerEvalResult] = useState<string | null>(null);
  const [serverEvalBusy, setServerEvalBusy] = useState(false);
  const [cancelAllOrdersBusy, setCancelAllOrdersBusy] = useState(false);

  const ibkrAccountId = useMemo(() => {
    const v = process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID;
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  }, []);

  const selectedRule = useMemo(
    () => rules.find((r) => r.id === selectedId) ?? null,
    [rules, selectedId],
  );

  useEffect(() => {
    if (selectedRule) {
      setForm(ruleToForm(selectedRule));
      setJsonText(JSON.stringify(selectedRule, null, 2));
    } else {
      setForm(emptyForm);
      setJsonText("");
    }
    setBuilderError(null);
    setJsonError(null);
  }, [selectedRule]);

  const handleSaveBuilder = useCallback(() => {
    setBuilderError(null);
    const createdAt = selectedRule?.createdAt;
    const parsed = formToRule(form, selectedId, createdAt);
    if ("error" in parsed) {
      setBuilderError(parsed.error);
      return;
    }
    const { rule } = parsed;
    if (selectedId) {
      updateRule(selectedId, { ...rule, id: selectedId, createdAt: createdAt! });
    } else {
      addRule(rule);
      setSelectedId(rule.id);
    }
  }, [addRule, form, selectedId, selectedRule?.createdAt, updateRule]);

  const handleSaveJson = useCallback(() => {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText) as unknown;
    } catch {
      setJsonError("Invalid JSON syntax.");
      return;
    }
    const v = validateRulePayload(parsed);
    if (!v.ok) {
      setJsonError(v.errors.join(" "));
      return;
    }
    const rule = v.rule;
    if (selectedId && rules.some((r) => r.id === selectedId)) {
      updateRule(selectedId, rule);
    } else {
      const withId = { ...rule, id: rule.id || newId() };
      if (!rules.some((r) => r.id === withId.id)) {
        addRule(withId);
      } else {
        updateRule(withId.id, withId);
      }
      setSelectedId(withId.id);
    }
  }, [addRule, jsonText, rules, selectedId, updateRule]);

  const runServerEvaluate = useCallback(async () => {
    setServerEvalResult(null);
    setServerEvalBusy(true);
    try {
      const enabled = rules.filter((r) => r.enabled);
      if (enabled.length === 0) {
        setServerEvalResult("No enabled rules to evaluate.");
        return;
      }
      const symbols = symbolsFromRules(enabled);
      const spark = await fetchSpark(symbols);
      const needHistory = new Set<string>();
      for (const r of enabled) {
        if (ruleNeedsHistory(r)) {
          needHistory.add(r.symbol.trim().toUpperCase());
        }
      }
      const closesBySymbol: Record<string, number[]> = {};
      await Promise.all(
        [...needHistory].map(async (sym) => {
          closesBySymbol[sym] = await fetchCloses(sym);
        }),
      );
      const prices = buildRulePriceData(spark, closesBySymbol);
      const res = await fetch("/api/rules/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: enabled, prices }),
      });
      const data = (await res.json()) as {
        error?: string;
        triggered?: Rule[];
        evaluated?: number;
      };
      if (!res.ok) {
        setServerEvalResult(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const trig = data.triggered ?? [];
      const ev = data.evaluated ?? 0;
      setServerEvalResult(
        `Evaluated ${ev} rule(s). ${trig.length} condition(s) met: ${trig.map((r) => r.name).join(", ") || "none"}.`,
      );
    } catch (e) {
      setServerEvalResult(
        e instanceof Error ? e.message : "Server evaluate failed",
      );
    } finally {
      setServerEvalBusy(false);
    }
  }, [rules]);

  const handleCancelAllIbkrOrders = useCallback(async () => {
    setCancelAllOrdersBusy(true);
    try {
      const res = await fetch("/api/ibkr/orders");
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text.trim() || `Request failed (${res.status})`);
      }
      const raw = text ? (JSON.parse(text) as unknown) : null;
      const rows = normalizeLiveOrders(raw);
      await cancelAllCancellableOrders(rows, ibkrAccountId);
      setServerEvalResult(
        "Cancel requests sent for all PreSubmitted / Submitted orders.",
      );
    } catch (e) {
      setServerEvalResult(
        e instanceof Error ? e.message : "Cancel all orders failed",
      );
    } finally {
      setCancelAllOrdersBusy(false);
    }
  }, [ibkrAccountId]);

  const showConditionNumber =
    form.conditionType !== "TIME_AT" &&
    form.conditionType !== "MA_CROSS_ABOVE" &&
    form.conditionType !== "MA_CROSS_BELOW";

  return (
    <div className="flex min-h-screen min-h-0 flex-col overflow-hidden bg-[var(--page-bg)] text-[var(--foreground)]">
      <Topbar />
      {engineStatus.killSwitch ? (
        <div
          className="shrink-0 animate-pulse bg-[var(--short)] py-2.5 text-center text-sm font-semibold text-white"
          role="alert"
        >
          Kill switch active — all automated trading is halted
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Rules engine
            </h1>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">
              Last check:{" "}
              {engineStatus.lastChecked
                ? formatDateTimeStable(engineStatus.lastChecked)
                : "—"}{" "}
              · Active rules: {engineStatus.activeRules} · Engine{" "}
              {engineStatus.running ? "running" : "paused"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const s = useRulesStore.getState().engineStatus;
                setEngineStatus({ ...s, running: !s.running });
              }}
              className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--hover-row)]"
            >
              {engineStatus.running ? "Pause engine" : "Resume engine"}
            </button>
            <button
              type="button"
              onClick={() => void runServerEvaluate()}
              disabled={serverEvalBusy}
              className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--hover-row)] disabled:opacity-50"
            >
              {serverEvalBusy ? "Evaluating…" : "Server evaluate (no orders)"}
            </button>
            <button
              type="button"
              onClick={() => void handleCancelAllIbkrOrders()}
              disabled={cancelAllOrdersBusy}
              className="rounded-[6px] border border-[var(--short)]/40 bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--short)] transition-colors hover:bg-[var(--short-bg)] disabled:opacity-50"
            >
              {cancelAllOrdersBusy ? "Cancelling…" : "Cancel all IBKR orders"}
            </button>
            {engineStatus.killSwitch ? (
              <button
                type="button"
                onClick={() => setKillSwitch(false)}
                className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--hover-row)]"
              >
                Disengage kill switch
              </button>
            ) : null}
            {!engineStatus.killSwitch ? (
              <button
                type="button"
                onClick={() => setKillSwitch(true)}
                className="rounded-[6px] bg-[var(--short)] px-5 py-2.5 text-sm font-bold tracking-wide text-white shadow-md transition-opacity hover:opacity-95"
              >
                Kill switch
              </button>
            ) : null}
          </div>
        </div>

        {serverEvalResult ? (
          <p className="shrink-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground-muted)]">
            {serverEvalResult}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <aside className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                Rules
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setForm(emptyForm);
                  setJsonText("");
                  setEditorTab("builder");
                }}
                className="text-xs font-semibold text-[var(--long)] hover:underline"
              >
                + New rule
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {rules.length === 0 ? (
                <p className="text-sm text-[var(--foreground-muted)]">
                  No rules yet.
                </p>
              ) : (
                rules.map((r) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(r.id);
                      }
                    }}
                    className={`cursor-pointer rounded-[var(--radius-card)] border p-3 text-left transition-colors ${
                      selectedId === r.id
                        ? "border-[var(--foreground-muted)] bg-[var(--surface)] shadow-sm"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground-subtle)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[var(--foreground)]">
                          {r.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--foreground-muted)]">
                          {r.symbol}
                        </p>
                        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
                          <span className="font-medium text-[var(--foreground)]">
                            If
                          </span>{" "}
                          {conditionSummary(r)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                          <span className="font-medium text-[var(--foreground)]">
                            Then
                          </span>{" "}
                          {actionSummary(r)}
                        </p>
                        <p className="mt-2 font-mono text-[10px] text-[var(--foreground-subtle)]">
                          Last:{" "}
                          {r.lastTriggered
                            ? formatDateTimeStable(r.lastTriggered)
                            : "never"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.enabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRule(r.id);
                          }}
                          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                            r.enabled ? "bg-[var(--long)]" : "bg-[var(--border)]"
                          }`}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200 ${
                              r.enabled ? "left-[26px]" : "left-1"
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRule(r.id);
                            if (selectedId === r.id) setSelectedId(null);
                          }}
                          className="rounded-[6px] p-1 text-[var(--short)] transition-colors hover:bg-[var(--short-bg)]"
                          aria-label={`Delete ${r.name}`}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden
                          >
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex min-h-[200px] max-h-[40vh] shrink-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--terminal-bg)]">
              <div className="border-b border-[var(--border)] px-3 py-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-subtle)]">
                  Engine log
                </h2>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] text-[var(--terminal-fg)]">
                {engineLog.length === 0 ? (
                  <p className="p-2 text-[var(--foreground-subtle)]">
                    No evaluations yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {engineLog.map((e) => (
                      <li key={e.id} className="border-b border-[var(--border)]/50 pb-2 last:border-0">
                        <div className="text-[10px] text-[var(--foreground-subtle)]">
                          {formatDateTimeStable(e.timestamp)}
                        </div>
                        <div className="text-[var(--terminal-fg)]">{e.ruleName}</div>
                        <div
                          className={
                            e.conditionMet ? "text-[var(--long)]" : "text-[var(--foreground-muted)]"
                          }
                        >
                          Condition: {e.conditionMet ? "met" : "not met"}
                          {e.actionTaken !== "none"
                            ? ` · ${e.actionTaken.replace("_", " ")}`
                            : ""}
                          {e.reason ? (
                            <span className="text-[var(--short)]"> — {e.reason}</span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex max-h-[28vh] shrink-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--terminal-bg)]">
              <div className="border-b border-[var(--border)] px-3 py-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--foreground-subtle)]">
                  Order attempts
                </h2>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px]">
                {orderAttemptLog.length === 0 ? (
                  <p className="p-2 text-[var(--foreground-subtle)]">
                    No order attempts yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {orderAttemptLog.map((o) => (
                      <li
                        key={o.id}
                        className="border-b border-[var(--border)]/50 pb-2 last:border-0"
                      >
                        <div className="text-[10px] text-[var(--foreground-subtle)]">
                          {formatDateTimeStable(o.timestamp)}
                        </div>
                        <div className="text-[var(--terminal-fg)]">{o.ruleName}</div>
                        <div
                          className={
                            o.outcome === "placed"
                              ? "text-[var(--long)]"
                              : o.outcome === "failed"
                                ? "text-[var(--short)]"
                                : "text-[var(--foreground-muted)]"
                          }
                        >
                          {o.outcome} — {o.reason}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex gap-1 border-b border-[var(--border)] p-2">
              <button
                type="button"
                onClick={() => setEditorTab("builder")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  editorTab === "builder"
                    ? "bg-[var(--foreground)] text-[var(--surface)]"
                    : "text-[var(--foreground-muted)] hover:bg-[var(--hover-row)]"
                }`}
              >
                UI Builder
              </button>
              <button
                type="button"
                onClick={() => setEditorTab("code")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  editorTab === "code"
                    ? "bg-[var(--foreground)] text-[var(--surface)]"
                    : "text-[var(--foreground-muted)] hover:bg-[var(--hover-row)]"
                }`}
              >
                Code (JSON)
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {editorTab === "builder" ? (
                <div className="mx-auto max-w-md space-y-5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--page-bg)] p-5">
                  <div>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                      Rule
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Name
                        </label>
                        <input
                          value={form.name}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, name: e.target.value }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Symbol
                        </label>
                        <input
                          value={form.symbol}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, symbol: e.target.value }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                          placeholder="AAPL"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Conid
                        </label>
                        <input
                          value={form.conid}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, conid: e.target.value }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                          placeholder="265598"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                      Condition
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Type
                        </label>
                        <select
                          value={form.conditionType}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              conditionType: e.target.value as RuleConditionType,
                            }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
                        >
                          {CONDITION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {showConditionNumber ? (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                            Value
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={form.conditionValue}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                conditionValue: e.target.value,
                              }))
                            }
                            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                          />
                        </div>
                      ) : form.conditionType === "TIME_AT" ? (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                            Time (HH:MM)
                          </label>
                          <input
                            value={form.conditionValue}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                conditionValue: e.target.value,
                              }))
                            }
                            placeholder="09:30"
                            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--foreground-muted)]">
                          Uses 20-period MA on daily closes from price history.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                      Action
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Side
                        </label>
                        <select
                          value={form.side}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              side: e.target.value as "long" | "short",
                            }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
                        >
                          <option value="long">Long</option>
                          <option value="short">Short</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Order type
                        </label>
                        <select
                          value={form.orderType}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              orderType: e.target.value as "MKT" | "LMT",
                            }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
                        >
                          <option value="MKT">MKT</option>
                          <option value="LMT">LMT</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                        Quantity
                      </label>
                      <input
                        type="number"
                        min={0.0001}
                        step="any"
                        value={form.quantity}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, quantity: e.target.value }))
                        }
                        className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                      />
                    </div>
                    {form.orderType === "LMT" ? (
                      <div className="mt-3">
                        <label className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]">
                          Limit price
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={form.price}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, price: e.target.value }))
                          }
                          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-sm text-[var(--foreground)]"
                        />
                      </div>
                    ) : null}
                  </div>

                  <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, enabled: e.target.checked }))
                      }
                      className="rounded border-[var(--border)]"
                    />
                    Enabled
                  </label>
                  {builderError ? (
                    <p className="text-sm text-[var(--short)]">{builderError}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleSaveBuilder}
                    className="h-11 w-full rounded-[6px] bg-[var(--foreground)] text-sm font-semibold text-[var(--surface)] transition-opacity hover:opacity-90"
                  >
                    Save rule
                  </button>
                </div>
              ) : (
                <div className="mx-auto max-w-xl space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--page-bg)] p-5">
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Paste a full JSON object matching the Rule type. Required
                    fields: id, name, symbol, conid, conditionType,
                    conditionValue, action, enabled, createdAt.
                  </p>
                  <textarea
                    value={jsonText}
                    onChange={(e) => {
                      setJsonText(e.target.value);
                      setJsonError(null);
                    }}
                    rows={18}
                    className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--terminal-bg)] p-3 font-mono text-xs text-[var(--terminal-fg)]"
                    spellCheck={false}
                    placeholder={`{
  "id": "…",
  "name": "RSI dip",
  "symbol": "AAPL",
  "conid": 265598,
  "conditionType": "RSI_BELOW",
  "conditionValue": 30,
  "action": { "side": "long", "orderType": "MKT", "quantity": 1 },
  "enabled": true,
  "createdAt": "2026-01-01T00:00:00.000Z"
}`}
                  />
                  {jsonError ? (
                    <p className="text-sm text-[var(--short)]">{jsonError}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleSaveJson}
                    className="rounded-[6px] bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-[var(--surface)] hover:opacity-90"
                  >
                    Validate & save
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
