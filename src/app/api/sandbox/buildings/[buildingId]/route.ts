import { z } from "zod";
import { updateBuilding } from "@/services/tenancy";
import { readJson, SANDBOX_ACTOR, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().nullish(),
  codePrefix: z.string().min(1).max(8).optional(),
  reason: z.string().optional(),
});

export const PATCH = sandboxRoute<RouteContext<"/api/sandbox/buildings/[buildingId]">>(async (request, context) => {
  const { buildingId } = await context.params;
  const { reason, ...changes } = schema.parse(await readJson(request));
  return updateBuilding({ buildingId: z.uuid().parse(buildingId), changes, actor: SANDBOX_ACTOR, reason });
});
