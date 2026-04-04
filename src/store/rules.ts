import { create } from "zustand";
import { persist } from "zustand/middleware";

import type {
  EngineLogEntry,
  OrderAttemptEntry,
  Rule,
  RuleEngineStatus,
} from "@/types/rules";

const MAX_ENGINE_LOG = 50;
const MAX_ORDER_LOG = 50;

const defaultEngineStatus: RuleEngineStatus = {
  running: true,
  killSwitch: false,
  lastChecked: "",
  activeRules: 0,
};

const HOUR_MS = 3_600_000;
const MAX_ORDERS_PER_HOUR = 3;

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type RulesStoreState = {
  rules: Rule[];
  engineStatus: RuleEngineStatus;
  /** Successful automation orders in the current {@link globalOrderHourWindowStartMs} window. */
  globalOrdersThisHour: number;
  /** Epoch ms when the current hourly cap window started; `0` means unset (first use will start a window). */
  globalOrderHourWindowStartMs: number;
  engineLog: EngineLogEntry[];
  orderAttemptLog: OrderAttemptEntry[];
  addRule: (rule: Rule) => void;
  updateRule: (id: string, partial: Partial<Rule>) => void;
  deleteRule: (id: string) => void;
  toggleRule: (id: string) => void;
  setKillSwitch: (value: boolean) => void;
  setEngineStatus: (status: RuleEngineStatus) => void;
  appendEngineLog: (entry: Omit<EngineLogEntry, "id">) => void;
  appendOrderAttemptLog: (entry: Omit<OrderAttemptEntry, "id">) => void;
  syncActiveRulesCount: () => void;
  /**
   * Rolls the hourly window if an hour has elapsed, then returns whether another
   * order is allowed (max 3 per rolling hour).
   */
  canPlaceOrderThisHour: (now: number) => boolean;
  /** Call only after a successful order POST. */
  recordOrderPlacedThisHour: (now: number) => void;
};

export const useRulesStore = create<RulesStoreState>()(
  persist(
    (set, get) => ({
      rules: [],
      engineStatus: { ...defaultEngineStatus },
      globalOrdersThisHour: 0,
      globalOrderHourWindowStartMs: 0,
      engineLog: [],
      orderAttemptLog: [],

      addRule: (rule) =>
        set((s) => ({
          rules: [...s.rules, rule],
        })),

      updateRule: (id, partial) =>
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, ...partial } : r)),
        })),

      deleteRule: (id) =>
        set((s) => ({
          rules: s.rules.filter((r) => r.id !== id),
        })),

      toggleRule: (id) =>
        set((s) => ({
          rules: s.rules.map((r) =>
            r.id === id ? { ...r, enabled: !r.enabled } : r,
          ),
        })),

      setKillSwitch: (value) =>
        set((s) => ({
          engineStatus: { ...s.engineStatus, killSwitch: value },
        })),

      setEngineStatus: (status) => set({ engineStatus: { ...status } }),

      appendEngineLog: (entry) =>
        set((s) => {
          const row: EngineLogEntry = { ...entry, id: newId() };
          return {
            engineLog: [row, ...s.engineLog].slice(0, MAX_ENGINE_LOG),
          };
        }),

      appendOrderAttemptLog: (entry) =>
        set((s) => {
          const row: OrderAttemptEntry = { ...entry, id: newId() };
          return {
            orderAttemptLog: [row, ...s.orderAttemptLog].slice(0, MAX_ORDER_LOG),
          };
        }),

      syncActiveRulesCount: () =>
        set((s) => ({
          engineStatus: {
            ...s.engineStatus,
            activeRules: s.rules.filter((r) => r.enabled).length,
          },
        })),

      canPlaceOrderThisHour: (now) => {
        const s = get();
        const start = s.globalOrderHourWindowStartMs;
        if (start === 0 || now - start >= HOUR_MS) {
          set({
            globalOrderHourWindowStartMs: now,
            globalOrdersThisHour: 0,
          });
          return true;
        }
        return s.globalOrdersThisHour < MAX_ORDERS_PER_HOUR;
      },

      recordOrderPlacedThisHour: (now) =>
        set((s) => {
          const start = s.globalOrderHourWindowStartMs;
          if (start === 0 || now - start >= HOUR_MS) {
            return {
              globalOrderHourWindowStartMs: now,
              globalOrdersThisHour: 1,
            };
          }
          return { globalOrdersThisHour: s.globalOrdersThisHour + 1 };
        }),
    }),
    {
      name: "meridian-rules",
      skipHydration: true,
      partialize: (s) => ({
        rules: s.rules,
        engineStatus: s.engineStatus,
        globalOrdersThisHour: s.globalOrdersThisHour,
        globalOrderHourWindowStartMs: s.globalOrderHourWindowStartMs,
      }),
    },
  ),
);
