import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getEnvironment } from "@/configuration/environment";
import { getDatabase, type Executor } from "@/database/client";
import { leases, payLinks, tenants } from "@/database/schema";
import { uniqueShortCode } from "@/utilities/short-codes";
import { smsLink } from "@/utilities/sms-text";

const DEFAULT_VALID_DAYS = 7;
const SHORT_CODE_LENGTH = 12;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function isShortCode(token: string): boolean {
  return /^[A-Za-z0-9]{12}$/.test(token);
}

/** Saves a new pay link for the lease and returns its 12-char short code. */
async function issuePayLinkCode(leaseId: string, options: { validDays?: number; database?: Executor } = {}): Promise<string> {
  const database = options.database ?? getDatabase();
  const token = randomBytes(32).toString("base64url");
  const shortCode = await uniqueShortCode(SHORT_CODE_LENGTH, async (code) => {
    const [existing] = await database.select({ id: payLinks.id }).from(payLinks).where(eq(payLinks.shortCode, code)).limit(1);
    return existing !== undefined;
  });
  const expiresAt = new Date(Date.now() + (options.validDays ?? DEFAULT_VALID_DAYS) * 86_400_000);
  await database.insert(payLinks).values({
    leaseId,
    tokenHash: hashToken(token),
    shortCode,
    expiresAt,
  });
  return shortCode;
}

/**
 * A one-tap link for SMS: host/pay-link/{shortCode}. Stores a 12-char short code plus a hashed long token.
 * Valid for 7 days unless told otherwise. `next` picks the page it opens ("pay" or "statement").
 */
export async function createPayLink(
  leaseId: string,
  options: { validDays?: number; next?: "pay" | "statement"; database?: Executor } = {},
): Promise<string> {
  const shortCode = await issuePayLinkCode(leaseId, options);
  const link = smsLink(getEnvironment().APP_URL, `/pay-link/${shortCode}`);
  return options.next === "statement" ? `${link}?next=statement` : link;
}

/**
 * A message-card link for SMS: host/bill/{shortCode}. Same 12-char pay-link code (7 days); opening it only
 * shows the card. Signing in happens when the tenant taps "Pay now" (a POST), so link previews can't do it.
 */
export async function createBillLink(leaseId: string, options: { validDays?: number; database?: Executor } = {}): Promise<string> {
  const shortCode = await issuePayLinkCode(leaseId, options);
  return smsLink(getEnvironment().APP_URL, `/bill/${shortCode}`);
}

/** The lease a pay-link short code belongs to, if it exists and hasn't expired. Read-only: does not count as a use. */
export async function findPayLinkLease(code: string): Promise<string | null> {
  if (!isShortCode(code)) return null;
  const [link] = await getDatabase()
    .select({ leaseId: payLinks.leaseId })
    .from(payLinks)
    .where(and(eq(payLinks.shortCode, code), gt(payLinks.expiresAt, new Date())))
    .limit(1);
  return link?.leaseId ?? null;
}

/** Checks a pay-link token or 12-char short code. Returns the tenant and lease it signs in to, or null if unknown or expired. */
export async function usePayLink(token: string): Promise<{ tenantId: string; leaseId: string } | null> {
  const database = getDatabase();

  let leaseId: string | undefined;
  if (isShortCode(token)) {
    const [link] = await database
      .update(payLinks)
      .set({ usedCount: sql`${payLinks.usedCount} + 1` })
      .where(and(eq(payLinks.shortCode, token), gt(payLinks.expiresAt, new Date())))
      .returning({ leaseId: payLinks.leaseId });
    leaseId = link?.leaseId;
  } else if (/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    const [link] = await database
      .update(payLinks)
      .set({ usedCount: sql`${payLinks.usedCount} + 1` })
      .where(and(eq(payLinks.tokenHash, hashToken(token)), gt(payLinks.expiresAt, new Date())))
      .returning({ leaseId: payLinks.leaseId });
    leaseId = link?.leaseId;
  } else {
    return null;
  }
  if (!leaseId) return null;

  const [lease] = await database
    .select({ tenantId: leases.tenantId, portalAccess: tenants.portalAccess })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(eq(leases.id, leaseId))
    .limit(1);
  if (!lease || !lease.portalAccess) return null;
  return { tenantId: lease.tenantId, leaseId };
}
