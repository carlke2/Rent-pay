import "server-only";
import { cache } from "react";
import { requireTenant } from "@/authentication/roles";
import { getTenantLease } from "@/services/portal";

/** The signed-in tenant and the lease their session is for (deduplicated per request). */
export const currentTenantLease = cache(async () => {
  const session = await requireTenant();
  const lease = await getTenantLease(session.subject, session.leaseId);
  return { tenantId: session.subject, lease };
});
