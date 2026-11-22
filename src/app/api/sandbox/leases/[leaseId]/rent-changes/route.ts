import { z } from "zod";
import { changeRent } from "@/services/tenancy";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ amount: wholeShillings.min(0), effectiveFrom: isoDate, reason: z.string().optional() });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/rent-changes">>(async (request, context) => {
  const { leaseId } = await context.params;
  return changeRent({ leaseId: z.uuid().parse(leaseId), ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR });
});
