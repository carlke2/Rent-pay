import { z } from "zod";
import { waiveCharge } from "@/services/billing";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const waiveSchema = z.object({ amount: wholeShillings.min(1), reason: z.string().trim().min(1).max(200), date: isoDate.optional() });

export const POST = sandboxRoute<RouteContext<"/api/sandbox/charges/[invoiceLineId]/waive">>(async (request, context) => {
  const { invoiceLineId } = await context.params;
  const body = waiveSchema.parse(await readJson(request));
  return waiveCharge({
    invoiceLineId: z.uuid().parse(invoiceLineId),
    amount: body.amount,
    reason: body.reason,
    actor: SANDBOX_ACTOR,
    today: body.date,
  });
});
