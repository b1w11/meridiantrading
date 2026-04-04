"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import useSWR from "swr";

import { useMeridianTheme } from "@/components/ThemeProvider";
import { formatPriceStable } from "@/lib/format-display";
import { parsePricesResponse } from "@/lib/prices-response";
import { WATCHLIST_ENTRIES } from "@/lib/watchlist-constants";

const nav = [
  { href: "/", label: "Workspace" },
  { href: "/rules", label: "Rules" },
] as const;

async function tickerFetcher(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Request failed (${res.status})`);
  }
  return parsePricesResponse(JSON.parse(text) as unknown);
}

function MonogramIcon() {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--foreground)]"
      aria-hidden
    >
      M
    </span>
  );
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

export function Topbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { theme, toggleTheme, ready: themeReady } = useMeridianTheme();
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
    () => WATCHLIST_ENTRIES.map((e) => e.symbol).join(","),
    [],
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

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-4">
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <div className="flex items-center gap-2">
          <MonogramIcon />
          <span className="text-[16px] font-semibold tracking-tight text-[var(--foreground)]">
            Meridian
          </span>
        </div>
        <nav className="hidden items-center gap-0.5 border-l border-[var(--border)] pl-3 sm:flex">
          {nav.map(({ href, label }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--row-alt)] text-[var(--foreground)]"
                    : "text-[var(--foreground-muted)] hover:bg-[var(--hover-row)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-x-auto px-1 sm:px-2">
        {WATCHLIST_ENTRIES.map(({ symbol }) => {
          const price = tickerData?.prices[symbol];
          const pct = tickerData?.pctChange[symbol];
          const hasPct = pct != null && Number.isFinite(pct);
          const pos = hasPct && pct >= 0;
          return (
            <div
              key={symbol}
              className="flex shrink-0 items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--page-bg)] px-2.5 py-1"
            >
              <span className="text-xs font-semibold text-[var(--foreground)]">
                {symbol}
              </span>
              <span className="font-mono text-xs tabular-nums text-[var(--foreground)]">
                {formatPriceStable(price)}
              </span>
              {hasPct ? (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${
                    pos
                      ? "bg-[var(--long-bg)] text-[var(--long)]"
                      : "bg-[var(--short-bg)] text-[var(--short)]"
                  }`}
                >
                  {pos ? "+" : ""}
                  {pct.toFixed(2)}%
                </span>
              ) : (
                <span className="rounded-md bg-[var(--row-alt)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--foreground-muted)]">
                  —
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => toggleTheme()}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--page-bg)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--hover-row)] hover:text-[var(--foreground)]"
          aria-label={
            themeReady && theme === "dark"
              ? "Switch to light mode"
              : "Switch to dark mode"
          }
        >
          {themeReady && theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        <div
          className="flex items-center gap-1.5 rounded-[6px] border border-transparent px-1"
          title={connected ? "Connected" : "Offline or signed out"}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              connected ? "bg-[var(--long)]" : "bg-[var(--foreground-subtle)]"
            } ${connected && online ? "shadow-[0_0_8px_rgba(34,197,94,0.5)]" : ""}`}
            aria-hidden
          />
          <span className="hidden text-[11px] text-[var(--foreground-muted)] lg:inline">
            {connected ? "Live" : "Idle"}
          </span>
        </div>

        {ibkrAccountId ? (
          <span
            className="hidden max-w-[100px] truncate font-mono text-[11px] text-[var(--foreground-muted)] xl:inline"
            title={ibkrAccountId}
          >
            {ibkrAccountId}
          </span>
        ) : null}

        {mounted && session?.user?.email ? (
          <span
            className="hidden max-w-[140px] truncate text-xs text-[var(--foreground-muted)] sm:inline md:max-w-[200px]"
            title={session.user.email}
          >
            {session.user.email}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="rounded-[6px] px-2 py-1.5 text-xs font-medium text-[var(--short)] transition-colors hover:bg-[var(--short-bg)]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
