import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getEnvironment } from "@/configuration/environment";
import { getDatabase } from "@/database/client";
import { loginCodes } from "@/database/schema";

export type LoginCodePurpose = "tenant_login" | "landlord_two_factor" | "phone_change";

export const LOGIN_CODE_LENGTH = 6;
export const CODE_LIFETIME_MINUTES = 5;
export const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MINUTES = 15;
const MAX_CODES_PER_WINDOW = 3;

function hashCode(purpose: LoginCodePurpose, phone: string, code: string): string {
  return createHmac("sha256", getEnvironment().SESSION_SECRET).update(`${purpose}:${phone}:${code}`).digest("base64url");
}

export type IssueResult = { issued: true; code: string; expiresAt: Date } | { issued: false; reason: "rate_limited" };

/**
 * Creates a one-time 6-digit code (only its hash is stored). Codes expire in 5 minutes, allow 5 attempts,
 * and a phone gets at most 3 codes per 15 minutes for each purpose.
 */
export async function issueLoginCode(phone: string, purpose: LoginCodePurpose = "tenant_login"): Promise<IssueResult> {
  const database = getDatabase();
  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000);
  const [recent] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(loginCodes)
    .where(and(eq(loginCodes.phone, phone), eq(loginCodes.purpose, purpose), gt(loginCodes.createdAt, windowStart)));
  if ((recent?.count ?? 0) >= MAX_CODES_PER_WINDOW) return { issued: false, reason: "rate_limited" };

  const code = String(randomInt(0, 10 ** LOGIN_CODE_LENGTH)).padStart(LOGIN_CODE_LENGTH, "0");
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MINUTES * 60_000);
  await database.insert(loginCodes).values({ phone, purpose, codeHash: hashCode(purpose, phone, code), expiresAt });
  return { issued: true, code, expiresAt };
}

export type CodeCheck = { valid: true } | { valid: false; reason: "no_code" | "wrong" | "used_up"; attemptsLeft: number };

/** Checks the newest unused, unexpired code for a phone and purpose. Consumes it on success. */
export async function verifyLoginCode(phone: string, code: string, purpose: LoginCodePurpose = "tenant_login"): Promise<boolean> {
  return (await checkLoginCode(phone, code, purpose)).valid;
}

/** Like verifyLoginCode, but says why a code failed and how many tries are left. */
export async function checkLoginCode(phone: string, code: string, purpose: LoginCodePurpose = "tenant_login"): Promise<CodeCheck> {
  const database = getDatabase();
  const [latest] = await database
    .select()
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.phone, phone),
        eq(loginCodes.purpose, purpose),
        isNull(loginCodes.usedAt),
        gt(loginCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!latest) return { valid: false, reason: "no_code", attemptsLeft: 0 };
  if (latest.attempts >= MAX_ATTEMPTS) return { valid: false, reason: "used_up", attemptsLeft: 0 };

  // Count the attempt first so parallel guesses can't exceed the limit.
  const [counted] = await database
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.id, latest.id), sql`${loginCodes.attempts} < ${MAX_ATTEMPTS}`, isNull(loginCodes.usedAt)))
    .returning({ id: loginCodes.id, attempts: loginCodes.attempts });
  if (!counted) return { valid: false, reason: "used_up", attemptsLeft: 0 };
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - counted.attempts);

  const expected = Buffer.from(latest.codeHash);
  const actual = Buffer.from(hashCode(purpose, phone, code));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false, reason: attemptsLeft > 0 ? "wrong" : "used_up", attemptsLeft };
  }

  const [used] = await database
    .update(loginCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(loginCodes.id, latest.id), isNull(loginCodes.usedAt)))
    .returning({ id: loginCodes.id });
  return used ? { valid: true } : { valid: false, reason: "used_up", attemptsLeft: 0 };
}
