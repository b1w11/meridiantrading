import { type NextRequest, NextResponse } from "next/server";

import {
  fetchGatewayWithSession,
  ensureIbkrDevTls,
  passthroughResponse,
} from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

const SUBSCRIBE_THEN_FETCH_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function GET(request: NextRequest) {
  const conids = request.nextUrl.searchParams.get("conids");
  if (!conids?.trim()) {
    return NextResponse.json(
      { error: "Missing required query parameter: conids" },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams({ conids: conids.trim() });
  const path = `/v1/api/iserver/marketdata/snapshot?${qs.toString()}`;

  try {
    ensureIbkrDevTls();
    // First snapshot primes the stream; second returns populated fields.
    const prime = await fetchGatewayWithSession(path, { method: "GET" });
    await prime.text();

    await sleep(SUBSCRIBE_THEN_FETCH_DELAY_MS);

    const upstream = await fetchGatewayWithSession(path, { method: "GET" });
    return passthroughResponse(upstream);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
