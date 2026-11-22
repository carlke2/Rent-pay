import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "@/configuration/environment";
import {
  SESSION_COOKIE_NAMES,
  SESSION_DURATION_SECONDS,
  signPendingToken,
  signSessionToken,
  verifyPendingToken,
  verifySessionToken,
  type PendingPurpose,
  type Role,
  type SessionClaims,
} from "./tokens";

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/", maxAge };
}

/**
 * Landlord: 12 hours. Tenant: 30 days. The token always expires then; `keepSignedIn: false` also makes the
 * cookie a browser-session cookie, so closing the browser signs the user out sooner.
 */
export async function createSession(claims: SessionClaims, options: { keepSignedIn?: boolean } = {}): Promise<void> {
  const token = await signSessionToken(claims);
  const store = await cookies();
  const { maxAge, ...sessionOnly } = cookieOptions(SESSION_DURATION_SECONDS[claims.role]);
  store.set(SESSION_COOKIE_NAMES[claims.role], token, options.keepSignedIn === false ? sessionOnly : { ...sessionOnly, maxAge });
}

export async function readSession(role: Role): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAMES[role])?.value, role);
}

export async function destroySession(role: Role): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAMES[role]);
}

const PENDING_COOKIE_NAMES: Record<PendingPurpose, string> = {
  landlord_two_factor: "rental_admin_pending",
  tenant_choose_lease: "rental_tenant_pending",
};
const PENDING_SECONDS = 10 * 60;

/** Remembers who is half-way through logging in (10 minutes). */
export async function setPendingLogin(purpose: PendingPurpose, subject: string): Promise<void> {
  const store = await cookies();
  store.set(PENDING_COOKIE_NAMES[purpose], await signPendingToken(purpose, subject, PENDING_SECONDS), cookieOptions(PENDING_SECONDS));
}

export async function readPendingLogin(purpose: PendingPurpose): Promise<string | null> {
  const store = await cookies();
  return verifyPendingToken(store.get(PENDING_COOKIE_NAMES[purpose])?.value, purpose);
}

export async function clearPendingLogin(purpose: PendingPurpose): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_COOKIE_NAMES[purpose]);
}
