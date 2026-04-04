"use client";

import { useEffect, useState } from "react";

import { useRuleEngine } from "@/hooks/useRuleEngine";
import { useRulesStore } from "@/store/rules";

function RuleEngineHost() {
  useRuleEngine();
  return null;
}

function RuleEngineAfterHydration() {
  const [persistReady, setPersistReady] = useState(false);

  useEffect(() => {
    const persistApi = useRulesStore.persist;
    if (
      !persistApi ||
      typeof persistApi.hasHydrated !== "function" ||
      typeof persistApi.onFinishHydration !== "function"
    ) {
      setPersistReady(true);
      return;
    }
    if (persistApi.hasHydrated()) {
      setPersistReady(true);
      return;
    }
    return persistApi.onFinishHydration(() => {
      setPersistReady(true);
    });
  }, []);

  if (!persistReady) {
    return null;
  }

  return <RuleEngineHost />;
}

export function RuleEngineRunner() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <RuleEngineAfterHydration />;
}
