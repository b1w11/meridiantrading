import { NextResponse } from "next/server";

import { proxyGateway } from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await proxyGateway("/v1/api/iserver/accounts", { method: "GET" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
