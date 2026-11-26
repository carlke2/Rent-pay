import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getEnvironment } from "@/configuration/environment";

/** Constant-time string comparison (hashing first so lengths don't leak). */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type CallbackKeyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks a Daraja callback's key, given as ?key= or as the last path segment (pathKey); either one matching is
 * enough. The Daraja sandbox drops query strings from registered C2B URLs, hence the path form.
 * With MPESA_ENV=sandbox, MPESA_SANDBOX_LEGACY_CALLBACK_KEY (if set) is accepted too.
 * The failure reason is safe to log: it shows at most the first 4 characters of the key that was sent.
 */
export function checkCallbackKey(request: Request, pathKey?: string): CallbackKeyCheck {
  const environment = getEnvironment();
  const expectedKeys = [environment.MPESA_CALLBACK_KEY];
  // The legacy key is a sandbox-only fallback: never accepted when MPESA_ENV=live, even if set.
  if (environment.MPESA_ENV === "sandbox" && environment.MPESA_SANDBOX_LEGACY_CALLBACK_KEY) {
    expectedKeys.push(environment.MPESA_SANDBOX_LEGACY_CALLBACK_KEY);
  }
  const candidates = [pathKey, new URL(request.url).searchParams.get("key")].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return { ok: false, reason: "missing key" };
  // Check every candidate so the time taken doesn't depend on which one matched.
  const matches = candidates.flatMap((candidate) => expectedKeys.map((expected) => secretsMatch(candidate, expected)));
  if (matches.some(Boolean)) return { ok: true };
  const prefix = (candidates[0] ?? "").slice(0, 4).replace(/[^A-Za-z0-9_-]/g, "?");
  return { ok: false, reason: `key mismatch (first 4 chars: ${prefix})` };
}

/** Checks Authorization: Bearer ${CRON_SECRET} on job routes. */
export function hasCronSecret(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return secretsMatch(token, getEnvironment().CRON_SECRET);
}
