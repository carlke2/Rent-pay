import { z } from "zod";
import { updateTenant } from "@/services/tenancy";
import { readJson, SANDBOX_ACTOR, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  nationalId: z.string().nullish(),
  alternativePhone: z.string().nullish(),
  whatsappOptIn: z.boolean().optional(),
  nextOfKin: z.object({ name: z.string(), phone: z.string(), relationship: z.string().optional() }).nullish(),
  portalAccess: z.boolean().optional(),
  reason: z.string().optional(),
});

export const PATCH = sandboxRoute<RouteContext<"/api/sandbox/tenants/[tenantId]">>(async (request, context) => {
  const { tenantId } = await context.params;
  const { reason, ...changes } = schema.parse(await readJson(request));
  return updateTenant({ tenantId: z.uuid().parse(tenantId), changes, actor: SANDBOX_ACTOR, reason });
});
