import "server-only";
import { and, count, eq, gte, inArray } from "drizzle-orm";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase } from "@/database/client";
import { leases, loginAttempts, tenants, units } from "@/database/schema";

/** Wrong phone-and-unit guesses allowed per phone number, and per network address, in the window. */
export const UNIT_LOGIN_MAX_FAILURES_PER_PHONE = 5;
export const UNIT_LOGIN_MAX_FAILURES_PER_ADDRESS = 20;
export const UNIT_LOGIN_WINDOW_MINUTES = 15;

export type UnitLoginResult =
  | { ok: true; tenantId: string; leaseId: string }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked" };

async function recentFailures(key: string, since: Date): Promise<number> {
  const [row] = await getDatabase()
    .select({ value: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), eq(loginAttempts.succeeded, false), gte(loginAttempts.createdAt, since)));
  return row?.value ?? 0;
}

/**
 * Signs a tenant in with their phone number and unit code (e.g. "ROOM1K"; spaces, dashes and case are ignored).
 * Matches a tenant with portal access whose current (active or on-notice) lease is for that unit.
 * Unit codes are easy to guess, so failures are limited per phone and per network address.
 */
export async function checkUnitLogin(input: { phone: string; unitCode: string; address: string | null }): Promise<UnitLoginResult> {
  const database = getDatabase();
  const since = new Date(Date.now() - UNIT_LOGIN_WINDOW_MINUTES * 60 * 1000);
  const phoneKey = `phone:${input.phone}`;
  const addressKey = input.address ? `address:${input.address}` : null;

  const [phoneFailures, addressFailures] = await Promise.all([recentFailures(phoneKey, since), addressKey ? recentFailures(addressKey, since) : Promise.resolve(0)]);
  if (phoneFailures >= UNIT_LOGIN_MAX_FAILURES_PER_PHONE || addressFailures >= UNIT_LOGIN_MAX_FAILURES_PER_ADDRESS) {
    return { ok: false, reason: "locked" };
  }

  const code = normaliseUnitCode(input.unitCode);
  const [match] = code
    ? await database
        .select({ tenantId: tenants.id, leaseId: leases.id })
        .from(tenants)
        .innerJoin(leases, eq(leases.tenantId, tenants.id))
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(and(eq(tenants.phone, input.phone), eq(tenants.portalAccess, true), inArray(leases.status, ["active", "notice"]), eq(units.normalisedCode, code)))
        .limit(1)
    : [];

  const succeeded = Boolean(match);
  await database.insert(loginAttempts).values([{ key: phoneKey, succeeded }, ...(addressKey ? [{ key: addressKey, succeeded }] : [])]);
  if (match) {
    await database.update(tenants).set({ lastLoginAt: new Date() }).where(eq(tenants.id, match.tenantId));
    return { ok: true, tenantId: match.tenantId, leaseId: match.leaseId };
  }
  return { ok: false, reason: "wrong", attemptsLeft: Math.max(0, UNIT_LOGIN_MAX_FAILURES_PER_PHONE - phoneFailures - 1) };
}
