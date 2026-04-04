/** Stable locale for SSR/client hydration (avoid `undefined` locale differences). */
const LOCALE = "en-US" as const;

export function formatMoneyStable(n: number): string {
  return n.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPriceStable(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return p.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateTimeStable(
  input: string | number | Date | null | undefined,
): string {
  if (input == null || input === "") return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(LOCALE, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
