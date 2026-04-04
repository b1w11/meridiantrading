"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });
      if (res?.error) {
        setError("Invalid email or password.");
        setPending(false);
        return;
      }
      router.push(res?.url ?? callbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-[var(--page-bg)] px-4 py-16">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--page-bg)] text-sm font-semibold text-[var(--foreground)]">
            M
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
            Meridian
          </h1>
          <p className="mt-1 text-xs text-[var(--foreground-muted)]">
            Sign in to continue
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--page-bg)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--foreground-subtle)] focus:border-[var(--foreground-muted)] focus:ring-1 focus:ring-[var(--foreground-muted)]"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-[11px] font-medium text-[var(--foreground-muted)]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--page-bg)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-shadow placeholder:text-[var(--foreground-subtle)] focus:border-[var(--foreground-muted)] focus:ring-1 focus:ring-[var(--foreground-muted)]"
            />
          </div>
          {error ? (
            <p
              className="rounded-[6px] border border-[var(--short)]/30 bg-[var(--short-bg)] px-3 py-2 text-xs text-[var(--short)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-full rounded-[6px] bg-[var(--foreground)] px-3 py-2 text-sm font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full flex-1 items-center justify-center bg-[var(--page-bg)] text-sm text-[var(--foreground-muted)]">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
