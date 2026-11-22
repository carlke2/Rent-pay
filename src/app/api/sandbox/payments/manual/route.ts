import { z } from "zod";
import { recordManualPayment } from "@/services/payments";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  leaseId: z.uuid(),
  amount: wholeShillings.min(1),
  paidOn: isoDate,
  method: z.enum(["bank", "cash"]),
  reference: z.string().nullish(),
  date: isoDate.optional(),
});

export const POST = sandboxRoute(async (request) => {
  const { date, ...body } = schema.parse(await readJson(request));
  return recordManualPayment({ ...body, actor: SANDBOX_ACTOR, today: date });
});
