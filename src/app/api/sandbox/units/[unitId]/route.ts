import { z } from "zod";
import { updateUnit } from "@/services/tenancy";
import { readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  floor: z.number().int().nullish(),
  rentAmount: wholeShillings.min(0).optional(),
  depositAmount: wholeShillings.min(0).optional(),
  meterNumber: z.string().nullish(),
  status: z.enum(["vacant", "reserved", "under_repair"]).optional(),
  reason: z.string().optional(),
});

export const PATCH = sandboxRoute<RouteContext<"/api/sandbox/units/[unitId]">>(async (request, context) => {
  const { unitId } = await context.params;
  const { reason, ...changes } = schema.parse(await readJson(request));
  return updateUnit({ unitId: z.uuid().parse(unitId), changes, actor: SANDBOX_ACTOR, reason });
});
