import { z } from "zod";
import { recordDepositRefund } from "@/services/tenancy";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ amount: wholeShillings.min(1), method: z.string().min(1), reference: z.string().nullish(), refundedOn: isoDate });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/deposit-refunds">>(async (request, context) => {
  const { leaseId } = await context.params;
  return recordDepositRefund({ leaseId: z.uuid().parse(leaseId), ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR });
});
