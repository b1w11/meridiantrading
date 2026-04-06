"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/** Dark mode is disabled for now; only `"light"` is supported. */
export type MeridianTheme = "light";

type ThemeContextValue = {
  theme: MeridianTheme;
  setTheme: (t: MeridianTheme) => void;
  toggleTheme: () => void;
  /** True after the document has been forced to light on the client. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.classList.remove("dark");
    setReady(true);
  }, []);

  const setTheme = useCallback((_t: MeridianTheme) => {
    /* dark mode removed for now */
  }, []);

  const toggleTheme = useCallback(() => {
    /* no-op */
  }, []);

  const value = useMemo(
    () => ({
      theme: "light" as const,
      setTheme,
      toggleTheme,
      ready,
    }),
    [setTheme, toggleTheme, ready],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useMeridianTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useMeridianTheme must be used within ThemeProvider");
  }
  return ctx;
}
