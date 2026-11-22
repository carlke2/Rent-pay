import { z } from "zod";
import { confirmPaymentClaim } from "@/services/payments";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = sandboxRoute<RouteContext<"/api/sandbox/payment-claims/[claimId]/confirm">>(async (request, context) => {
  const { claimId } = await context.params;
  const { date } = z.object({ date: isoDate.optional() }).parse(await readJson(request));
  return confirmPaymentClaim({ claimId: z.uuid().parse(claimId), actor: SANDBOX_ACTOR, today: date });
});
