import { z } from "zod";
import { rejectPaymentClaim } from "@/services/payments";
import { readJson, SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = sandboxRoute<RouteContext<"/api/sandbox/payment-claims/[claimId]/reject">>(async (request, context) => {
  const { claimId } = await context.params;
  const { reason } = z.object({ reason: z.string().min(1) }).parse(await readJson(request));
  return rejectPaymentClaim({ claimId: z.uuid().parse(claimId), reason, actor: SANDBOX_ACTOR });
});
