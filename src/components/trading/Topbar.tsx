"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { useMeridianTheme } from "@/components/ThemeProvider";
import { formatPriceStable } from "@/lib/format-display";
import { parsePricesResponse } from "@/lib/prices-response";
import { cn } from "@/lib/utils";
import { useTradingStore } from "@/store/trading";

async function tickerFetcher(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  return parsePricesResponse(JSON.parse(text) as unknown);
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Single stroke “M” mark — avoids a text node that reads as a second “M” before “Meridian”. */
function MonogramIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      className="text-foreground"
      aria-hidden
    >
      <path
        d="M4 18V6l8 10 8-10V18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { theme, toggleTheme, ready: themeReady } = useMeridianTheme();
  const watchlistEntries = useTradingStore((s) => s.watchlistEntries);
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setMounted(true);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const symbolsParam = useMemo(
    () => watchlistEntries.map((e) => e.symbol).join(","),
    [watchlistEntries],
  );

  const tickerUrl =
    mounted && symbolsParam.length > 0
      ? `/api/prices?symbols=${encodeURIComponent(symbolsParam)}`
      : null;

  const { data: tickerData } = useSWR(tickerUrl, tickerFetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  const ibkrAccountId =
    typeof process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID === "string"
      ? process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID.trim() || undefined
      : undefined;

  const connected =
    mounted &&
    status === "authenticated" &&
    online &&
    session?.user != null;

  const isLiveEnv =
    process.env.NEXT_PUBLIC_IBKR_LIVE === "true" ||
    process.env.NEXT_PUBLIC_IBKR_PAPER === "false";
  const isPaper = !isLiveEnv;

  const workspaceActive = pathname === "/";
  const rulesActive =
    pathname === "/rules" || pathname.startsWith("/rules/");

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <Link
          href="/"
          aria-label="Meridian home"
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <MonogramIcon />
          </span>
          <span className="truncate text-base font-semibold tracking-tight">
            Meridian
          </span>
        </Link>
        <nav className="hidden items-center border-l border-border pl-2 sm:flex sm:pl-3">
          <Link
            href="/"
            className={cn(
              "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
              workspaceActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Workspace
          </Link>
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-3 overflow-x-auto px-1 py-1 sm:px-2">
        {watchlistEntries.map(({ symbol }, i) => {
          const price = tickerData?.prices[symbol];
          const pct = tickerData?.pctChange[symbol];
          const hasPct = pct != null && Number.isFinite(pct);
          const pos = hasPct && pct >= 0;
          return (
            <Fragment key={symbol}>
              {i > 0 ? (
                <span
                  className="mx-2 shrink-0 select-none text-gray-300 dark:text-neutral-600"
                  aria-hidden
                >
                  |
                </span>
              ) : null}
              <span
                className="inline-flex h-auto shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 font-normal sm:px-3 sm:py-1.5"
              >
                <span className="text-xs font-semibold">{symbol}</span>
                <span className="font-mono text-xs tabular-nums text-foreground">
                  {formatPriceStable(price)}
                </span>
                {hasPct ? (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums",
                      pos
                        ? "bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400"
                        : "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400",
                    )}
                  >
                    {pos ? "+" : ""}
                    {pct.toFixed(2)}%
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    —
                  </span>
                )}
              </span>
            </Fragment>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-l border-border pl-2 sm:gap-3 sm:pl-3">
        <Link
          href="/rules"
          className={cn(
            "inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium transition-colors sm:px-2.5",
            rulesActive
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Rules
        </Link>
      </div>

      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div
          className="flex max-w-[120px] items-center gap-1.5 sm:max-w-none"
          title={
            !connected
              ? "Session idle"
              : isPaper
                ? "Paper trading"
                : "Live trading"
          }
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isPaper ? "bg-amber-500" : "bg-green-600",
              !connected && "opacity-40",
            )}
            aria-hidden
          />
          <span className="text-[10px] font-medium leading-none text-muted-foreground">
            {isPaper ? "Paper" : "Live"}
            {!connected ? (
              <span className="font-normal text-muted-foreground/80"> · idle</span>
            ) : null}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shadow-none"
          onClick={() => toggleTheme()}
          aria-label={
            themeReady && theme === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
        >
          {themeReady && theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </Button>

        {ibkrAccountId ? (
          <span
            className="hidden max-w-[100px] truncate font-mono text-[11px] text-muted-foreground xl:inline"
            title={ibkrAccountId}
          >
            {ibkrAccountId}
          </span>
        ) : null}

        {mounted && session?.user?.email ? (
          <span
            className="hidden max-w-[140px] truncate text-xs text-muted-foreground sm:inline md:max-w-[200px]"
            title={session.user.email}
          >
            {session.user.email}
          </span>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
