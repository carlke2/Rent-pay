import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDatabase, type Executor } from "@/database/client";
import { fetchOffsetPage } from "@/database/keyset";
import type { PageRequest } from "@/utilities/pagination";
import { buildings, expenses, units } from "@/database/schema";
import { assertIsoDate, type IsoDate } from "@/utilities/dates";
import { writeAudit } from "./audit";
import { ServiceError } from "./errors";

type ExpenseFields = {
  buildingId: string;
  unitId?: string | null;
  category: string;
  amount: number;
  spentOn: IsoDate;
  note?: string | null;
};

async function cleanFields(database: Executor, fields: ExpenseFields) {
  const category = fields.category.trim();
  if (!category || category.length > 60) throw new ServiceError("Category is required (at most 60 characters)");
  if (!Number.isSafeInteger(fields.amount) || fields.amount < 1) throw new ServiceError("Amount must be a whole number of at least 1");
  const spentOn = assertIsoDate(fields.spentOn);
  const [building] = await database.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, fields.buildingId));
  if (!building) throw new ServiceError("Building not found");
  if (fields.unitId) {
    const [unit] = await database.select({ buildingId: units.buildingId }).from(units).where(eq(units.id, fields.unitId));
    if (!unit) throw new ServiceError("Unit not found");
    if (unit.buildingId !== fields.buildingId) throw new ServiceError("That unit is not in this building");
  }
  return { buildingId: fields.buildingId, unitId: fields.unitId ?? null, category, amount: fields.amount, spentOn, note: fields.note?.trim() || null };
}

export async function createExpense(input: ExpenseFields & { actor: string }) {
  return getDatabase().transaction(async (transaction) => {
    const values = await cleanFields(transaction, input);
    const [expense] = await transaction.insert(expenses).values(values).returning();
    await writeAudit(transaction, { actor: input.actor, action: "expense.create", entity: "expense", entityId: expense?.id, after: expense });
    return expense;
  });
}

export async function updateExpense(input: { expenseId: string; changes: Partial<ExpenseFields>; actor: string; reason?: string }) {
  return getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
    if (!before) throw new ServiceError("Expense not found");
    const values = await cleanFields(transaction, {
      buildingId: input.changes.buildingId ?? before.buildingId,
      unitId: input.changes.unitId !== undefined ? input.changes.unitId : before.unitId,
      category: input.changes.category ?? before.category,
      amount: input.changes.amount ?? before.amount,
      spentOn: input.changes.spentOn ?? before.spentOn,
      note: input.changes.note !== undefined ? input.changes.note : before.note,
    });
    const [after] = await transaction.update(expenses).set(values).where(eq(expenses.id, input.expenseId)).returning();
    await writeAudit(transaction, { actor: input.actor, action: "expense.update", entity: "expense", entityId: before.id, before, after, reason: input.reason });
    return after;
  });
}

/** Deletes an expense; the audit row keeps a copy of what was deleted. */
export async function deleteExpense(input: { expenseId: string; actor: string; reason?: string }) {
  return getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select().from(expenses).where(eq(expenses.id, input.expenseId)).for("update");
    if (!before) throw new ServiceError("Expense not found");
    await transaction.delete(expenses).where(eq(expenses.id, input.expenseId));
    await writeAudit(transaction, { actor: input.actor, action: "expense.delete", entity: "expense", entityId: before.id, before, reason: input.reason });
    return { deleted: true, expenseId: before.id };
  });
}

type ExpenseFilter = { from?: IsoDate; to?: IsoDate; buildingId?: string | null };

function expenseConditions(input: ExpenseFilter) {
  return and(
    input.from ? gte(expenses.spentOn, assertIsoDate(input.from)) : undefined,
    input.to ? lte(expenses.spentOn, assertIsoDate(input.to)) : undefined,
    input.buildingId ? eq(expenses.buildingId, input.buildingId) : undefined,
  );
}

function expenseQuery(input: ExpenseFilter) {
  return getDatabase()
    .select({
      id: expenses.id,
      spentOn: expenses.spentOn,
      buildingId: expenses.buildingId,
      buildingName: buildings.name,
      unitId: expenses.unitId,
      unitCode: units.code,
      category: expenses.category,
      amount: expenses.amount,
      note: expenses.note,
    })
    .from(expenses)
    .innerJoin(buildings, eq(buildings.id, expenses.buildingId))
    .leftJoin(units, eq(units.id, expenses.unitId))
    .where(expenseConditions(input))
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt), desc(expenses.id))
    .$dynamic();
}

export async function listExpenses(input: ExpenseFilter = {}) {
  return expenseQuery(input);
}

/** One page (25) of expenses, newest first, plus the total spent across every page. */
export async function pageExpenses(input: ExpenseFilter, request: PageRequest) {
  let totalAmount = 0;
  const page = await fetchOffsetPage({
    request,
    count: async () => {
      const [row] = await getDatabase()
        .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
        .from(expenses)
        .where(expenseConditions(input));
      totalAmount = row?.amount ?? 0;
      return row?.count ?? 0;
    },
    fetch: (limit, offset) => expenseQuery(input).limit(limit).offset(offset),
  });
  return { ...page, totalAmount };
}
