import { ensureIbkrDevTls, gatewayUrl } from "@/lib/ibkr-gateway";

export type IBKROrder = {
  acctId: string;
  conid: number;
  orderType: string;
  side: string;
  quantity: number;
  tif: string;
  price?: number;
  auxPrice?: number;
};

export type IBKROrderResponse = Record<string, unknown>;

export async function gatewayFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  ensureIbkrDevTls();
  const res = await fetch(gatewayUrl(path), {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "string"
        ? parsed
        : JSON.stringify(parsed ?? { status: res.status });
    throw new Error(`IBKR gateway ${res.status}: ${msg}`);
  }
  return parsed as T;
}

export type PlaceOrderInput = {
  conid: number;
  orderType: string;
  side: string;
  quantity: number;
  tif: string;
  price?: number | null;
  stopPrice?: number | null;
};

/** Submit one order via Client Portal Web API (plural `/orders` + `{ orders: [...] }`). */
export async function submitIbkrOrder(
  acctId: string,
  body: PlaceOrderInput,
  ibkrSide: string,
): Promise<IBKROrderResponse[]> {
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

  return gatewayFetch<IBKROrderResponse[]>(
    `/v1/api/iserver/account/${acctId}/orders`,
    { method: "POST", body: { orders: [order] } },
  );
}
