import { type NextRequest, NextResponse } from "next/server";

import {
  gatewayUrl,
  ensureIbkrDevTls,
  passthroughResponse,
  requireIbkrAccountId,
} from "@/lib/ibkr-gateway";

export const dynamic = "force-dynamic";

/** List live / open orders (session). */
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();
  const path = search
    ? `/v1/api/iserver/account/orders?${search}`
    : "/v1/api/iserver/account/orders";

  try {
    ensureIbkrDevTls();
    const upstream = await fetch(gatewayUrl(path), { method: "GET" });
    return passthroughResponse(upstream);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

type PlaceOrderBody = {
  conid: number;
  orderType: string;
  side: string;
  quantity: number;
  tif: string;
  price?: number | null;
  stopPrice?: number | null;
};

const MAX_REPLY_CHAIN = 12;

/** IBKR warning codes we may auto-dismiss; anything else is returned for user confirmation. */
const SAFE_ORDER_MESSAGE_IDS = new Set([
  "o354", // no market data
  "o163", // outside trading hours
  "o382", // paper trading
]);

function parseJsonResponse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * IBKR confirmation challenge shape: `[{ id, message: string[], messageIds?: string[] }]`.
 */
function replyIdWhenMessageArray(response: unknown): string | null {
  if (!Array.isArray(response) || response.length === 0) return null;
  const first = response[0];
  if (!first || typeof first !== "object") return null;
  const rec = first as Record<string, unknown>;
  if (!Array.isArray(rec.message)) return null;
  const id = rec.id;
  return typeof id === "string" && id ? id : null;
}

/**
 * Auto-confirm only when every `messageIds` entry is a known-safe warning code.
 * Missing, empty, or non-array `messageIds` → do not auto-confirm.
 */
function challengeUsesOnlySafeMessageIds(response: unknown): boolean {
  if (!Array.isArray(response) || response.length === 0) return false;
  const first = response[0];
  if (!first || typeof first !== "object") return false;
  const rec = first as Record<string, unknown>;
  const messageIds = rec.messageIds;
  if (!Array.isArray(messageIds) || messageIds.length === 0) return false;
  for (const raw of messageIds) {
    if (typeof raw !== "string") return false;
    const code = raw.trim().toLowerCase();
    if (!SAFE_ORDER_MESSAGE_IDS.has(code)) return false;
  }
  return true;
}

/**
 * Place one order: `side` `"long"` → BUY, `"short"` → SELL; `{ orders: [order] }` to gateway.
 * Auto-confirms only safe IBKR warnings (o354 / o163 / o382); other challenges are returned as JSON.
 */
export async function POST(request: NextRequest) {
  const acctId = requireIbkrAccountId();
  if (!acctId) {
    return NextResponse.json(
      { error: "IBKR_ACCOUNT_ID is not set" },
      { status: 400 },
    );
  }

  let body: PlaceOrderBody;
  try {
    const parsed: unknown = JSON.parse(await request.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Expected a JSON object with order fields" },
        { status: 400 },
      );
    }
    body = parsed as PlaceOrderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const required: (keyof PlaceOrderBody)[] = [
    "conid",
    "orderType",
    "side",
    "quantity",
    "tif",
  ];
  for (const key of required) {
    if (body[key] === undefined || body[key] === null || body[key] === "") {
      return NextResponse.json(
        { error: `Missing required field: ${key}` },
        { status: 400 },
      );
    }
  }

  let ibkrSide: "BUY" | "SELL";
  if (body.side === "long") ibkrSide = "BUY";
  else if (body.side === "short") ibkrSide = "SELL";
  else {
    return NextResponse.json(
      { error: 'side must be "long" or "short"' },
      { status: 400 },
    );
  }

  const order = {
    acctId,
    conid: body.conid,
    orderType: body.orderType,
    side: ibkrSide,
    quantity: body.quantity,
    tif: body.tif,
    ...(body.price != null && { price: body.price }),
    ...(body.stopPrice != null && { auxPrice: body.stopPrice }),
  };

  const path = `/v1/api/iserver/account/${encodeURIComponent(acctId)}/orders`;

  try {
    ensureIbkrDevTls();
    const upstream = await fetch(gatewayUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: [order] }),
    });

    const rawText = await upstream.text();
    let data: unknown = parseJsonResponse(rawText);

    if (!upstream.ok) {
      return NextResponse.json(
        data !== null && typeof data === "object"
          ? (data as Record<string, unknown>)
          : { error: String(data), status: upstream.status },
        { status: upstream.status },
      );
    }

    // Confirmation challenges: only POST /iserver/reply when every messageId is in the safe allowlist.
    for (let step = 0; step < MAX_REPLY_CHAIN; step += 1) {
      const replyId = replyIdWhenMessageArray(data);
      if (!replyId) break;

      if (!challengeUsesOnlySafeMessageIds(data)) {
        return NextResponse.json(data as object);
      }

      const replyRes = await fetch(
        gatewayUrl(`/v1/api/iserver/reply/${encodeURIComponent(replyId)}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      const replyText = await replyRes.text();
      data = parseJsonResponse(replyText);

      if (!replyRes.ok) {
        return NextResponse.json(
          data !== null && typeof data === "object"
            ? (data as Record<string, unknown>)
            : { error: String(data), status: replyRes.status },
          { status: replyRes.status },
        );
      }
    }

    return NextResponse.json(data as object);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Cancel order: `DELETE /api/ibkr/orders?orderId=<id>&accountId=<id>` (accountId optional; defaults to server env). */
export async function DELETE(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId?.trim()) {
    return NextResponse.json(
      { error: "Missing required query parameter: orderId" },
      { status: 400 },
    );
  }

  const queryAccount = request.nextUrl.searchParams.get("accountId")?.trim();
  const accountId = queryAccount || requireIbkrAccountId();
  if (!accountId) {
    return NextResponse.json(
      { error: "IBKR_ACCOUNT_ID is not set and accountId query param was not provided" },
      { status: 400 },
    );
  }

  const path = `/v1/api/iserver/account/${encodeURIComponent(accountId)}/order/${encodeURIComponent(orderId.trim())}`;

  try {
    ensureIbkrDevTls();
    const upstream = await fetch(gatewayUrl(path), { method: "DELETE" });
    return passthroughResponse(upstream);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gateway request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
