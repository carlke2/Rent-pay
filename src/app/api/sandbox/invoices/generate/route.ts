import { z } from "zod";
import { generateInvoices } from "@/services/billing";
import { periodOf, todayInNairobi } from "@/utilities/dates";
import { billingPeriod, isoDate, readJson, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const generateSchema = z.object({
  period: billingPeriod.optional(),
  dryRun: z.boolean().default(false),
  date: isoDate.optional(),
});

export const POST = sandboxRoute(async (request) => {
  const body = generateSchema.parse(await readJson(request));
  const today = body.date ?? todayInNairobi();
  return generateInvoices({ period: body.period ?? periodOf(today), today, dryRun: body.dryRun });
});
