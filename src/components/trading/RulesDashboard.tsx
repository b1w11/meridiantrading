"use client";

import {
  AlertTriangle,
  FileSliders,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Topbar } from "@/components/trading/Topbar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
import { useTradingStore } from "@/store/trading";
import type {
  EngineLogEntry,
  OrderAttemptEntry,
  Rule,
  RuleConditionType,
} from "@/types/rules";

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

function ruleRowSubtitle(r: Rule): string {
  return `${conditionSummary(r)} → ${actionSummary(r)}`;
}

function engineLogResultClass(e: EngineLogEntry): string {
  if (e.conditionMet) return "text-green-600";
  if (e.reason) return "text-red-500";
  return "text-muted-foreground";
}

function engineLogResultText(e: EngineLogEntry): string {
  if (e.conditionMet) {
    const tail =
      e.actionTaken !== "none"
        ? ` · ${e.actionTaken.replace("_", " ")}`
        : "";
    return e.reason ? `Triggered${tail} · ${e.reason}` : `Triggered${tail}`;
  }
  if (e.reason) return `Not triggered · ${e.reason}`;
  return "Not triggered";
}

function orderAttemptResultClass(o: OrderAttemptEntry): string {
  if (o.outcome === "placed") return "text-green-600";
  if (o.outcome === "failed") return "text-red-500";
  return "text-muted-foreground";
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
  const [creatingNew, setCreatingNew] = useState(false);
  const [editorTab, setEditorTab] = useState<"builder" | "code">("builder");
  const [form, setForm] = useState<BuilderForm>(emptyForm);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [serverEvalResult, setServerEvalResult] = useState<string | null>(null);
  const [serverEvalBusy, setServerEvalBusy] = useState(false);
  const [cancelAllOrdersBusy, setCancelAllOrdersBusy] = useState(false);

  const ibkrAccountId = useTradingStore((s) => s.ibkrAccountId);

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
    setCreatingNew(false);
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
    setCreatingNew(false);
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

  const showEditor = selectedId !== null || creatingNew;
  const showEmptyPanel = selectedId === null && !creatingNew;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <Topbar />

      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                engineStatus.running ? "bg-green-600" : "bg-red-500",
              )}
              aria-hidden
            />
            <span className="font-medium text-foreground">
              {engineStatus.running ? "Running" : "Stopped"}
            </span>
          </span>
          <span className="hidden sm:inline" aria-hidden>
            ·
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            Last check:{" "}
            {engineStatus.lastChecked
              ? formatDateTimeStable(engineStatus.lastChecked)
              : "—"}
          </span>
          <span className="hidden sm:inline" aria-hidden>
            ·
          </span>
          <span>Active rules: {engineStatus.activeRules}</span>
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
            {engineStatus.running ? "Pause" : "Resume"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shadow-none"
            onClick={() => void runServerEvaluate()}
            disabled={serverEvalBusy}
          >
            {serverEvalBusy ? "Evaluating…" : "Server evaluate"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shadow-none"
            onClick={() => void handleCancelAllIbkrOrders()}
            disabled={cancelAllOrdersBusy}
          >
            {cancelAllOrdersBusy ? "Cancelling…" : "Cancel all orders"}
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
              size="sm"
              className="shadow-none"
              onClick={() => setKillSwitch(true)}
            >
              Kill switch
            </Button>
          ) : null}
        </div>
      </header>

      {engineStatus.killSwitch ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700"
          role="alert"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            Kill switch actief — alle geautomatiseerde handel is gestopt
          </span>
        </div>
      ) : null}

      {serverEvalResult ? (
        <div className="shrink-0 border-b border-border bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
          {serverEvalResult}
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[360px_1fr] gap-0 overflow-hidden">
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-border">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Rules</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shadow-none"
              onClick={() => {
                setCreatingNew(true);
                setSelectedId(null);
                setForm(emptyForm);
                setJsonText("");
                setEditorTab("builder");
              }}
            >
              + New rule
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {rules.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No rules yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {rules.map((r, idx) => (
                  <li key={r.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setCreatingNew(false);
                        setSelectedId(r.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setCreatingNew(false);
                          setSelectedId(r.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 border-l-4 py-3 pr-3 pl-4 transition-colors",
                        r.enabled
                          ? "border-l-green-600"
                          : "border-l-muted-foreground/30",
                        selectedId === r.id ? "bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{r.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ruleRowSubtitle(r)}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          Last:{" "}
                          {r.lastTriggered
                            ? formatDateTimeStable(r.lastTriggered)
                            : "never"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        <span
                          className="inline-flex shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Switch
                            checked={r.enabled}
                            onCheckedChange={() => toggleRule(r.id)}
                            aria-label={r.enabled ? "Disable rule" : "Enable rule"}
                          />
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-8 shrink-0 text-muted-foreground hover:text-red-600"
                          aria-label={`Delete ${r.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRule(r.id);
                            if (selectedId === r.id) {
                              setSelectedId(null);
                              setCreatingNew(false);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    {idx < rules.length - 1 ? (
                      <Separator className="mx-4" />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-border px-2 py-2">
            <Collapsible defaultOpen className="border-b border-border last:border-b-0">
              <CollapsibleTrigger className="px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Engine log
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-2">
                <ScrollArea className="h-48 w-full rounded-md border border-border">
                  <div className="p-3 font-mono text-xs">
                    {engineLog.length === 0 ? (
                      <p className="text-muted-foreground">No evaluations yet.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {engineLog.map((e) => (
                          <li key={e.id} className="leading-snug">
                            <span className="text-xs text-muted-foreground">
                              {formatDateTimeStable(e.timestamp)}
                            </span>{" "}
                            <span className="text-foreground">{e.ruleName}</span>{" "}
                            <span className={engineLogResultClass(e)}>
                              {engineLogResultText(e)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible defaultOpen className="pt-2">
              <CollapsibleTrigger className="px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Order attempts
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-2">
                <ScrollArea className="h-48 w-full rounded-md border border-border">
                  <div className="p-3 font-mono text-xs">
                    {orderAttemptLog.length === 0 ? (
                      <p className="text-muted-foreground">
                        No order attempts yet.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {orderAttemptLog.map((o) => (
                          <li key={o.id} className="leading-snug">
                            <span className="text-xs text-muted-foreground">
                              {formatDateTimeStable(o.timestamp)}
                            </span>{" "}
                            <span className="text-foreground">{o.ruleName}</span>{" "}
                            <span className={orderAttemptResultClass(o)}>
                              {o.outcome} — {o.reason}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden p-6">
          {showEmptyPanel ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <FileSliders
                className="size-12 text-muted-foreground/40"
                strokeWidth={1.25}
                aria-hidden
              />
              <p className="max-w-xs text-sm text-muted-foreground">
                Select a rule to edit or create a new one
              </p>
            </div>
          ) : null}

          {showEditor ? (
            <Tabs
              value={editorTab}
              onValueChange={(v) => {
                if (v === "builder" || v === "code") setEditorTab(v);
              }}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <TabsList variant="line" className="mb-4 w-fit shrink-0 shadow-none">
                <TabsTrigger value="builder" className="text-xs shadow-none">
                  UI Builder
                </TabsTrigger>
                <TabsTrigger value="code" className="text-xs shadow-none">
                  Code (JSON)
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="builder"
                className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
              >
                <div className="mx-auto w-full max-w-lg space-y-6 pb-8">
                  <div>
                    <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
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
                        <div className="relative">
                          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={form.symbol}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, symbol: e.target.value }))
                            }
                            placeholder="AAPL"
                            className="font-mono pl-9 shadow-none"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">
                          Conid
                        </label>
                        <Input
                          value={form.conid}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, conid: e.target.value }))
                          }
                          placeholder="265598"
                          className="h-8 font-mono text-sm text-muted-foreground shadow-none"
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      Condition
                    </h3>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                          Type
                        </label>
                        <Select
                          value={form.conditionType}
                          onValueChange={(v) => {
                            if (v != null) {
                              setForm((f) => ({
                                ...f,
                                conditionType: v as RuleConditionType,
                              }));
                            }
                          }}
                        >
                          <SelectTrigger className="w-full shadow-none" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONDITION_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                            Time
                          </label>
                          <Input
                            type="time"
                            step={60}
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
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Uses 20-period MA on daily closes from price history.
                        </p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      Action
                    </h3>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          Side
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={form.side === "long" ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "shadow-none",
                              form.side === "long" &&
                                "border-green-600 bg-green-600 text-white hover:bg-green-600/90",
                            )}
                            onClick={() =>
                              setForm((f) => ({ ...f, side: "long" }))
                            }
                          >
                            Long
                          </Button>
                          <Button
                            type="button"
                            variant={form.side === "short" ? "default" : "outline"}
                            size="sm"
                            className={cn(
                              "shadow-none",
                              form.side === "short" &&
                                "border-red-500 bg-red-500 text-white hover:bg-red-500/90",
                            )}
                            onClick={() =>
                              setForm((f) => ({ ...f, side: "short" }))
                            }
                          >
                            Short
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">
                          Order type
                        </label>
                        <Select
                          value={form.orderType}
                          onValueChange={(v) => {
                            if (v === "MKT" || v === "LMT") {
                              setForm((f) => ({ ...f, orderType: v }));
                            }
                          }}
                        >
                          <SelectTrigger className="w-full shadow-none" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MKT">MKT</SelectItem>
                            <SelectItem value="LMT">LMT</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
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
                        <div className="space-y-2">
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
                  </div>

                  <Separator />

                  <div className="flex items-center gap-3">
                    <Switch
                      id="rule-enabled"
                      checked={form.enabled}
                      onCheckedChange={(checked) =>
                        setForm((f) => ({ ...f, enabled: checked }))
                      }
                    />
                    <label
                      htmlFor="rule-enabled"
                      className="text-sm font-medium text-muted-foreground"
                    >
                      Rule enabled
                    </label>
                  </div>

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
                </div>
              </TabsContent>

              <TabsContent
                value="code"
                className="mt-0 flex min-h-0 flex-1 flex-col outline-none"
              >
                <p className="mb-3 shrink-0 text-xs text-muted-foreground">
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
                  spellCheck={false}
                  className="min-h-[min(60vh,480px)] w-full flex-1 resize-y rounded-lg border border-border bg-muted p-4 font-mono text-xs outline-none"
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
                  <p className="mt-2 shrink-0 text-sm text-red-500">{jsonError}</p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full shrink-0 shadow-none sm:w-auto"
                  onClick={handleSaveJson}
                >
                  Validate & save
                </Button>
              </TabsContent>
            </Tabs>
          ) : null}
        </main>
      </div>
    </div>
  );

}
