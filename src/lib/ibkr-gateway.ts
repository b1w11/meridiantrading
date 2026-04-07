const DEFAULT_GATEWAY = "https://localhost:5000";

let devTlsConfigured = false;

/** IBKR Client Portal gateway uses a self-signed cert; relax TLS verification in development only. */
export function ensureIbkrDevTls(): void {
  if (devTlsConfigured) return;
  devTlsConfigured = true;
  if (process.env.NODE_ENV === "development") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}

export function getIbkrGatewayBase(): string {
  return (process.env.IBKR_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, "");
}

export function getIbkrAccountId(): string | undefined {
  const id = process.env.IBKR_ACCOUNT_ID?.trim();
  return id || undefined;
}

export function requireIbkrAccountId(): string | null {
  return getIbkrAccountId() ?? null;
}

export function gatewayUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getIbkrGatewayBase()}${p}`;
}

const ISERVER_ACCOUNTS_PATH = "/v1/api/iserver/accounts";

function iserverPathRequiresAccountsPrime(path: string): boolean {
  const base = path.split("?")[0] ?? path;
  return (
    base.startsWith("/v1/api/iserver/") && base !== ISERVER_ACCOUNTS_PATH
  );
}

/** CP Web API returns this until `GET /iserver/accounts` has been called for the session. */
function isQueryAccountsFirstPayload(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  try {
    const j = JSON.parse(t) as { error?: unknown };
    if (typeof j.error !== "string") return false;
    const e = j.error.toLowerCase();
    return e.includes("accounts") && e.includes("first");
  } catch {
    return false;
  }
}

function responseFromText(upstream: Response, text: string): Response {
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  return new Response(text, { status: upstream.status, headers });
}

/**
 * For `/v1/api/iserver/*` (except `/iserver/accounts`), primes the gateway session
 * when the API responds with "query /accounts first", then retries once.
 */
export async function fetchGatewayWithSession(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  ensureIbkrDevTls();
  const url = gatewayUrl(path);

  if (!iserverPathRequiresAccountsPrime(path)) {
    return fetch(url, init);
  }

  let res = await fetch(url, init);
  const text = await res.text();
  if (!isQueryAccountsFirstPayload(text)) {
    return responseFromText(res, text);
  }

  await fetch(gatewayUrl(ISERVER_ACCOUNTS_PATH), { method: "GET" });
  return fetch(url, init);
}

/** Forward upstream response body and status to the client. */
export function passthroughResponse(upstream: Response): Response {
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function proxyGateway(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const upstream = await fetchGatewayWithSession(path, init);
  return passthroughResponse(upstream);
}
