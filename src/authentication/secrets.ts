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

/** Checks ?key= on a Daraja callback URL against MPESA_CALLBACK_KEY. */
export function hasCallbackKey(request: Request): boolean {
  return secretsMatch(new URL(request.url).searchParams.get("key"), getEnvironment().MPESA_CALLBACK_KEY);
}

/** Checks Authorization: Bearer ${CRON_SECRET} on job routes. */
export function hasCronSecret(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return secretsMatch(token, getEnvironment().CRON_SECRET);
}
