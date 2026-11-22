import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { getEnvironment } from "@/configuration/environment";

/** Session tokens only; no Next.js imports so proxy.ts can use this directly. */
export type Role = "landlord" | "tenant";

export type SessionClaims = {
  /** Landlord ID or tenant ID. */
  subject: string;
  role: Role;
  /** Tenants only: the lease this session is for (chosen at login when there is more than one). */
  leaseId?: string;
};

export const SESSION_COOKIE_NAMES: Record<Role, string> = {
  landlord: "rental_admin_session",
  tenant: "rental_tenant_session",
};

export const SESSION_DURATION_SECONDS: Record<Role, number> = {
  landlord: 60 * 60 * 12,
  tenant: 60 * 60 * 24 * 30,
};

const ISSUER = "rental";

function key(): Uint8Array {
  return new TextEncoder().encode(getEnvironment().SESSION_SECRET);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims.leaseId ? { role: claims.role, leaseId: claims.leaseId } : { role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.subject)
    .setIssuer(ISSUER)
    .setAudience(claims.role)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS[claims.role]}s`)
    .sign(key());
}

/** Returns the claims if the token is valid for the expected role, otherwise null. */
export async function verifySessionToken(token: string | undefined, role: Role): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: role, algorithms: ["HS256"] });
    if (payload.role !== role || typeof payload.sub !== "string") return null;
    return typeof payload.leaseId === "string" ? { subject: payload.sub, role, leaseId: payload.leaseId } : { subject: payload.sub, role };
  } catch {
    return null;
  }
}

/** Short-lived tokens for half-finished logins (password accepted, SMS code pending; or lease not chosen yet). */
export type PendingPurpose = "landlord_two_factor" | "tenant_choose_lease";

export async function signPendingToken(purpose: PendingPurpose, subject: string, seconds: number): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(`pending:${purpose}`)
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(key());
}

export async function verifyPendingToken(token: string | undefined, purpose: PendingPurpose): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, audience: `pending:${purpose}`, algorithms: ["HS256"] });
    return payload.purpose === purpose && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
