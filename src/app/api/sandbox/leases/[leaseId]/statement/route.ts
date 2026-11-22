import { z } from "zod";
import { getLeaseStatement } from "@/services/billing";
import { isoDate, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sandboxRoute<RouteContext<"/api/sandbox/leases/[leaseId]/statement">>(async (request, context) => {
  const { leaseId } = await context.params;
  const url = new URL(request.url);
  return getLeaseStatement({
    leaseId: z.uuid().parse(leaseId),
    from: isoDate.optional().parse(url.searchParams.get("from") ?? undefined),
    to: isoDate.optional().parse(url.searchParams.get("to") ?? undefined),
  });
});
