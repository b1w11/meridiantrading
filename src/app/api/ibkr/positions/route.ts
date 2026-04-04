import { NextResponse } from "next/server";

import { proxyGateway, requireIbkrAccountId } from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  const accountId = requireIbkrAccountId();
  if (!accountId) {
    return NextResponse.json(
      { error: "IBKR_ACCOUNT_ID is not set" },
      { status: 400 },
    );
  }

  try {
    const path = `/v1/api/portfolio/${encodeURIComponent(accountId)}/positions/0`;
    return await proxyGateway(path, { method: "GET" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
