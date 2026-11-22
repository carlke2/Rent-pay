import { z } from "zod";
import { createExpense, listExpenses } from "@/services/expenses";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = sandboxRoute(async (request) => {
  const url = new URL(request.url);
  return {
    expenses: await listExpenses({
      from: isoDate.optional().parse(url.searchParams.get("from") ?? undefined),
      to: isoDate.optional().parse(url.searchParams.get("to") ?? undefined),
      buildingId: z.uuid().optional().parse(url.searchParams.get("buildingId") ?? undefined),
    }),
  };
});

const schema = z.object({
  buildingId: z.uuid(),
  unitId: z.uuid().nullish(),
  category: z.string().min(1).max(60),
  amount: wholeShillings.min(1),
  spentOn: isoDate,
  note: z.string().nullish(),
});

export const POST = sandboxRoute(async (request) => createExpense({ ...schema.parse(await readJson(request)), actor: SANDBOX_ACTOR }));
