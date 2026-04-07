import { type NextRequest, NextResponse } from "next/server";

import { proxyGateway } from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol?.trim()) {
    return NextResponse.json(
      { error: "Missing required query parameter: symbol" },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams({ symbol: symbol.trim() });
  const path = `/v1/api/iserver/secdef/search?${qs.toString()}`;

  try {
    return await proxyGateway(path, { method: "GET" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
