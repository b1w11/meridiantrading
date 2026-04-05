"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Topbar } from "@/components/trading/Topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
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
    <div className="flex min-h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <Topbar />
      {engineStatus.killSwitch ? (
        <div
          className="shrink-0 animate-pulse bg-red-600 py-3 text-center text-sm font-semibold text-white"
          role="alert"
        >
          Kill switch active — all automated trading is halted
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight md:text-xl">
              Rules engine
            </h1>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">
              Last check:{" "}
              {engineStatus.lastChecked
                ? formatDateTimeStable(engineStatus.lastChecked)
                : "—"}{" "}
              · Active rules: {engineStatus.activeRules} · Engine{" "}
              {engineStatus.running ? "running" : "paused"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shadow-none"
              onClick={() => {
                const s = useRulesStore.getState().engineStatus;
                setEngineStatus({ ...s, running: !s.running });
              }}
            >
              {engineStatus.running ? "Pause engine" : "Resume engine"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shadow-none"
              onClick={() => void runServerEvaluate()}
              disabled={serverEvalBusy}
            >
              {serverEvalBusy ? "Evaluating…" : "Server evaluate (no orders)"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-red-500 shadow-none hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => void handleCancelAllIbkrOrders()}
              disabled={cancelAllOrdersBusy}
            >
              {cancelAllOrdersBusy ? "Cancelling…" : "Cancel all IBKR orders"}
            </Button>
            {engineStatus.killSwitch ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shadow-none"
                onClick={() => setKillSwitch(false)}
              >
                Disengage kill switch
              </Button>
            ) : null}
            {!engineStatus.killSwitch ? (
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="shadow-none bg-red-600 text-white hover:bg-red-600/90"
                onClick={() => setKillSwitch(true)}
              >
                Kill switch
              </Button>
            ) : null}
          </div>
        </div>

        <Separator />

        {serverEvalResult ? (
          <Card className="shrink-0 border-border py-3 shadow-none">
            <CardContent className="px-4 py-0 text-xs text-muted-foreground">
              {serverEvalResult}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[400px_1fr] gap-6 overflow-hidden">
          <aside className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-1">
              <h2 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
                Rules
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-green-600 shadow-none hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-950/30"
                onClick={() => {
                  setSelectedId(null);
                  setForm(emptyForm);
                  setJsonText("");
                  setEditorTab("builder");
                }}
              >
                + New rule
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-1">
              {rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rules yet.</p>
              ) : (
                rules.map((r) => (
                  <Card
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    size="sm"
                    onClick={() => setSelectedId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(r.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer py-2 shadow-none transition-colors",
                      selectedId === r.id
                        ? "ring-2 ring-foreground/20"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <CardHeader className="gap-2 px-3 py-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <CardTitle className="truncate text-sm font-semibold">
                            {r.name}
                          </CardTitle>
                          <p className="font-mono text-xs text-muted-foreground">
                            {r.symbol}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "cursor-pointer border-0 font-normal",
                              r.enabled
                                ? "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400"
                                : "bg-muted text-muted-foreground",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRule(r.id);
                            }}
                          >
                            {r.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="size-7 text-red-500 shadow-none hover:bg-red-50 dark:hover:bg-red-950/30"
                            aria-label={`Delete ${r.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRule(r.id);
                              if (selectedId === r.id) setSelectedId(null);
                            }}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              aria-hidden
                            >
                              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14M10 11v6M14 11v6" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 px-3 pt-2 pb-0 text-xs text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">If</span>{" "}
                        {conditionSummary(r)}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Then</span>{" "}
                        {actionSummary(r)}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/80">
                        Last:{" "}
                        {r.lastTriggered
                          ? formatDateTimeStable(r.lastTriggered)
                          : "never"}
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            <Card className="flex shrink-0 flex-col overflow-hidden py-0 shadow-none">
              <CardHeader className="shrink-0 border-b border-border py-2">
                <CardTitle className="text-xs font-medium">Engine log</CardTitle>
              </CardHeader>
              <ScrollArea className="h-[200px] w-full">
                <div className="p-3 font-mono text-xs leading-snug">
                  {engineLog.length === 0 ? (
                    <p className="text-muted-foreground">No evaluations yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {engineLog.map((e) => (
                        <li
                          key={e.id}
                          className="border-b border-border pb-2 last:border-0"
                        >
                          <div className="text-[10px] text-muted-foreground">
                            {formatDateTimeStable(e.timestamp)}
                          </div>
                          <div className="text-foreground">{e.ruleName}</div>
                          <div
                            className={
                              e.conditionMet
                                ? "text-green-600"
                                : "text-muted-foreground"
                            }
                          >
                            Condition: {e.conditionMet ? "met" : "not met"}
                            {e.actionTaken !== "none"
                              ? ` · ${e.actionTaken.replace("_", " ")}`
                              : ""}
                            {e.reason ? (
                              <span className="text-red-500"> — {e.reason}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </ScrollArea>
            </Card>

            <Card className="flex shrink-0 flex-col overflow-hidden py-0 shadow-none">
              <CardHeader className="shrink-0 border-b border-border py-2">
                <CardTitle className="text-xs font-medium">
                  Order attempts
                </CardTitle>
              </CardHeader>
              <ScrollArea className="h-[200px] w-full">
                <div className="p-3 font-mono text-xs leading-snug">
                  {orderAttemptLog.length === 0 ? (
                    <p className="text-muted-foreground">
                      No order attempts yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {orderAttemptLog.map((o) => (
                        <li
                          key={o.id}
                          className="border-b border-border pb-2 last:border-0"
                        >
                          <div className="text-[10px] text-muted-foreground">
                            {formatDateTimeStable(o.timestamp)}
                          </div>
                          <div>{o.ruleName}</div>
                          <div
                            className={
                              o.outcome === "placed"
                                ? "text-green-600"
                                : o.outcome === "failed"
                                  ? "text-red-500"
                                  : "text-muted-foreground"
                            }
                          >
                            {o.outcome} — {o.reason}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-none">
            <Tabs
              value={editorTab}
              onValueChange={(v) => {
                if (v === "builder" || v === "code") setEditorTab(v);
              }}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="shrink-0 border-b border-border px-3 pt-3">
                <TabsList variant="line" className="shadow-none">
                  <TabsTrigger value="builder" className="text-xs shadow-none">
                    UI Builder
                  </TabsTrigger>
                  <TabsTrigger value="code" className="text-xs shadow-none">
                    Code (JSON)
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="builder"
                className="min-h-0 flex-1 overflow-y-auto p-4 outline-none"
              >
                <Card className="mx-auto max-w-md border-border shadow-none">
                  <CardContent className="space-y-6 p-6">
                    <div>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Rule
                      </h3>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Name
                          </label>
                          <Input
                            value={form.name}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, name: e.target.value }))
                            }
                            className="shadow-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Symbol
                          </label>
                          <Input
                            value={form.symbol}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, symbol: e.target.value }))
                            }
                            placeholder="AAPL"
                            className="font-mono shadow-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Conid
                          </label>
                          <Input
                            value={form.conid}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, conid: e.target.value }))
                            }
                            placeholder="265598"
                            className="font-mono shadow-none"
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Condition
                      </h3>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
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
                            className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-none outline-none"
                          >
                            {CONDITION_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {showConditionNumber ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">
                              Value
                            </label>
                            <Input
                              type="number"
                              step="any"
                              value={form.conditionValue}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  conditionValue: e.target.value,
                                }))
                              }
                              className="font-mono shadow-none"
                            />
                          </div>
                        ) : form.conditionType === "TIME_AT" ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">
                              Time (HH:MM)
                            </label>
                            <Input
                              value={form.conditionValue}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  conditionValue: e.target.value,
                                }))
                              }
                              placeholder="09:30"
                              className="font-mono shadow-none"
                            />
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Uses 20-period MA on daily closes from price
                            history.
                          </p>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Action
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
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
                            className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-none"
                          >
                            <option value="long">Long</option>
                            <option value="short">Short</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
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
                            className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-none"
                          >
                            <option value="MKT">MKT</option>
                            <option value="LMT">LMT</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                          Quantity
                        </label>
                        <Input
                          type="number"
                          min={0.0001}
                          step="any"
                          value={form.quantity}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, quantity: e.target.value }))
                          }
                          className="font-mono shadow-none"
                        />
                      </div>
                      {form.orderType === "LMT" ? (
                        <div className="mt-3 space-y-2">
                          <label className="text-sm font-medium text-muted-foreground">
                            Limit price
                          </label>
                          <Input
                            type="number"
                            step="any"
                            value={form.price}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, price: e.target.value }))
                            }
                            className="font-mono shadow-none"
                          />
                        </div>
                      ) : null}
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, enabled: e.target.checked }))
                        }
                        className="rounded border-input"
                      />
                      Enabled
                    </label>
                    {builderError ? (
                      <p className="text-sm text-red-500">{builderError}</p>
                    ) : null}
                    <Button
                      type="button"
                      className="h-11 w-full shadow-none"
                      onClick={handleSaveBuilder}
                    >
                      Save rule
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent
                value="code"
                className="min-h-0 flex-1 overflow-y-auto p-4 outline-none"
              >
                <Card className="mx-auto max-w-xl border-border shadow-none">
                  <CardContent className="space-y-4 p-6">
                    <p className="text-xs text-muted-foreground">
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
                      className="w-full resize-y rounded-lg border border-input bg-muted/30 p-3 font-mono text-xs shadow-none outline-none"
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
                      <p className="text-sm text-red-500">{jsonError}</p>
                    ) : null}
                    <Button
                      type="button"
                      className="shadow-none"
                      onClick={handleSaveJson}
                    >
                      Validate & save
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </div>
  );
}
