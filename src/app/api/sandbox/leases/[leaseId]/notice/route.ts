import { z } from "zod";
import { giveNotice } from "@/services/tenancy";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ noticeDate: isoDate, moveOutDate: isoDate, reason: z.string().optional() });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/notice">>(async (request, context) => {
  const { leaseId } = await context.params;
  return giveNotice({ leaseId: z.uuid().parse(leaseId), ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR });
});
