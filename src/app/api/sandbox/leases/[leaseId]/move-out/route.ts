import { z } from "zod";
import { moveOut } from "@/services/tenancy";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  moveOutDate: isoDate,
  finalReading: z.number().int().min(0).nullish(),
  deductions: z.array(z.object({ description: z.string().min(1), amount: wholeShillings.min(1) })).default([]),
  date: isoDate.optional(),
});

export const POST = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/move-out">>(async (request, context) => {
  const { leaseId } = await context.params;
  const { date, ...body } = schema.parse(await readJson(request));
  return moveOut({ leaseId: z.uuid().parse(leaseId), ...body, actor: SANDBOX_ACTOR, today: date });
});
