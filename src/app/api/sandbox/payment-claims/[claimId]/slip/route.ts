import { z } from "zod";
import { getClaimSlipUrl } from "@/services/payments";
import { sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sandboxRoute<RouteContext<"/api/sandbox/payment-claims/[claimId]/slip">>(async (_request, context) => {
  const { claimId } = await context.params;
  return { url: await getClaimSlipUrl(z.uuid().parse(claimId)) };
});
