import "server-only";
import { getEnvironment } from "@/configuration/environment";
import type { AccessTokenResponse, DarajaErrorBody } from "./types";

const BASE_URLS = {
  sandbox: "https://sandbox.safaricom.co.ke",
  live: "https://api.safaricom.co.ke",
} as const;

const REQUEST_TIMEOUT_MILLISECONDS = 20_000;

export class DarajaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "DarajaError";
  }
}

export function darajaBaseUrl(): string {
  return BASE_URLS[getEnvironment().MPESA_ENV];
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorFrom(status: number, body: unknown, fallback: string): DarajaError {
  const details = (typeof body === "object" && body !== null ? body : {}) as DarajaErrorBody & {
    ResponseDescription?: string;
  };
  const message = details.errorMessage ?? details.ResponseDescription ?? (typeof body === "string" && body ? body : fallback);
  return new DarajaError(`Daraja: ${message}`, status, details.errorCode, body);
}

let cachedToken: { value: string; expiresAt: number } | undefined;

/** OAuth token, cached in memory until 60 seconds before it expires. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { MPESA_CONSUMER_KEY: key, MPESA_CONSUMER_SECRET: secret } = getEnvironment();
  if (!key || !secret) {
    throw new DarajaError("Daraja: set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET first", 0);
  }

  const response = await fetch(`${darajaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok || typeof body !== "object" || body === null || !("access_token" in body)) {
    throw errorFrom(response.status, body, `could not get an access token (HTTP ${response.status})`);
  }

  const token = body as AccessTokenResponse;
  const lifetimeSeconds = Number(token.expires_in) || 3599;
  cachedToken = { value: token.access_token, expiresAt: Date.now() + (lifetimeSeconds - 60) * 1000 };
  return token.access_token;
}

/** POSTs JSON to Daraja. Throws DarajaError (with Daraja's errorMessage) on failure. */
export async function darajaPost<TResponse>(path: string, payload: object): Promise<TResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${darajaBaseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    cache: "no-store",
  });
  const body = await readBody(response);

  if (response.status === 401 || (body as DarajaErrorBody | null)?.errorCode === "404.001.03") cachedToken = undefined;
  if (!response.ok || typeof body !== "object" || body === null || "errorCode" in body) {
    throw errorFrom(response.status, body, `request to ${path} failed (HTTP ${response.status})`);
  }
  const responseCode = (body as { ResponseCode?: unknown }).ResponseCode;
  if (responseCode !== undefined && String(responseCode) !== "0") {
    throw errorFrom(response.status, body, `request to ${path} was refused`);
  }
  return body as TResponse;
}
