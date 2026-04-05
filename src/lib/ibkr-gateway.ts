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
  const server = process.env.IBKR_ACCOUNT_ID?.trim();
  const publicId = process.env.NEXT_PUBLIC_IBKR_ACCOUNT_ID?.trim();
  return server || publicId || undefined;
}

export function requireIbkrAccountId(): string | null {
  return getIbkrAccountId() ?? null;
}

export function gatewayUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getIbkrGatewayBase()}${p}`;
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
  ensureIbkrDevTls();
  const upstream = await fetch(gatewayUrl(path), init);
  return passthroughResponse(upstream);
}
