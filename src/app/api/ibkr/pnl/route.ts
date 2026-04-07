import { type NextRequest, NextResponse } from "next/server";

import { proxyGateway } from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const basePath = "/v1/api/iserver/account/pnl/partitioned";
  const search = request.nextUrl.searchParams.toString();
  const path = search ? `${basePath}?${search}` : basePath;

  try {
    return await proxyGateway(path, { method: "GET" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
