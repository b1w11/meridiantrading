"use client";

import { useEffect, useState } from "react";

import { useRulesStore } from "@/store/rules";

/**
 * Call after mount so persisted rules state loads from localStorage on the client only
 * (see `skipHydration` on {@link useRulesStore}).
 */
export function PersistRehydration() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void useRulesStore.persist?.rehydrate?.();
  }, [mounted]);

  return null;
}
