import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Exposes the configured IBKR account id to authenticated clients without
 * embedding it in NEXT_PUBLIC_* env vars.
 */
export async function GET() {
  const raw = process.env.IBKR_ACCOUNT_ID;
  const accountId =
    typeof raw === "string" && raw.trim() ? raw.trim() : null;
  return NextResponse.json({ accountId });
}
