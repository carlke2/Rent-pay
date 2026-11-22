import { z } from "zod";
import { reversePayment } from "@/services/payments";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().min(1), date: isoDate.optional() });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/payments/[paymentId]/reverse">>(async (request, context) => {
  const { paymentId } = await context.params;
  const { reason, date } = schema.parse(await readJson(request));
  return reversePayment({ paymentId: z.uuid().parse(paymentId), reason, actor: SANDBOX_ACTOR, today: date });
});
