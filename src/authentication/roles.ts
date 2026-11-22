import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "./session";
import type { SessionClaims } from "./tokens";

/** For landlord pages and actions. proxy.ts guards pages too; this also covers server actions. */
export async function requireLandlord(): Promise<SessionClaims> {
  const session = await readSession("landlord");
  if (!session) redirect("/admin/login");
  return session;
}

/** For tenant portal pages and actions. The subject is the tenant ID. */
export async function requireTenant(): Promise<SessionClaims> {
  const session = await readSession("tenant");
  if (!session) redirect("/tenants/login");
  return session;
}
