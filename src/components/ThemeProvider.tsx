"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "meridian-theme";

export type MeridianTheme = "light" | "dark";

type ThemeContextValue = {
  theme: MeridianTheme;
  setTheme: (t: MeridianTheme) => void;
  toggleTheme: () => void;
  /** True after localStorage / DOM class have been applied on the client. */
  ready: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyDomTheme(theme: MeridianTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<MeridianTheme>("light");
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    let initial: MeridianTheme = "light";
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as MeridianTheme | null;
      if (stored === "dark" || stored === "light") {
        initial = stored;
      } else if (document.documentElement.classList.contains("dark")) {
        initial = "dark";
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        initial = "dark";
      }
    } catch {
      /* ignore */
    }
    setThemeState(initial);
    applyDomTheme(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyDomTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, ready]);

  const setTheme = useCallback((t: MeridianTheme) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      ready,
    }),
    [theme, setTheme, toggleTheme, ready],
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
