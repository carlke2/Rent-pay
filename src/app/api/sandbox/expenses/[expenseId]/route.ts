import { z } from "zod";
import { deleteExpense, updateExpense } from "@/services/expenses";
import { isoDate, readJson, SANDBOX_ACTOR, sandboxRoute, wholeShillings } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = RouteContext<"/api/sandbox/expenses/[expenseId]">;

const schema = z.object({
  buildingId: z.uuid().optional(),
  unitId: z.uuid().nullish(),
  category: z.string().min(1).max(60).optional(),
  amount: wholeShillings.min(1).optional(),
  spentOn: isoDate.optional(),
  note: z.string().nullish(),
  reason: z.string().optional(),
});

export const PATCH = sandboxRoute<Context>(async (request, context) => {
  const { expenseId } = await context.params;
  const { reason, ...changes } = schema.parse(await readJson(request));
  return updateExpense({ expenseId: z.uuid().parse(expenseId), changes, actor: SANDBOX_ACTOR, reason });
});

export const DELETE = sandboxRoute<Context>(async (request, context) => {
  const { expenseId } = await context.params;
  const reason = new URL(request.url).searchParams.get("reason") ?? undefined;
  return deleteExpense({ expenseId: z.uuid().parse(expenseId), actor: SANDBOX_ACTOR, reason });
});
