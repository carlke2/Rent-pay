"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { createExpense, deleteExpense, updateExpense } from "@/services/expenses";
import { identifier, isoDate, optionalText, requiredText, runAction, shillings } from "./run";

const fields = {
  buildingId: identifier("Building"),
  unitId: z.uuid().optional(),
  category: requiredText("Category", 60),
  amount: shillings(),
  spentOn: isoDate("Date"),
  note: optionalText(300),
};

export async function createExpenseAction(_state: ActionState, formData: FormData) {
  return runAction(z.object(fields), formData, async (input, { actor }) => {
    await createExpense({ ...input, actor });
    return { message: "Expense added" };
  });
}

export async function updateExpenseAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ expenseId: identifier("Expense"), ...fields }), formData, async ({ expenseId, ...changes }, { actor }) => {
    await updateExpense({ expenseId, changes: { ...changes, unitId: changes.unitId ?? null, note: changes.note ?? null }, actor });
    return { message: "Expense saved" };
  });
}

export async function deleteExpenseAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ expenseId: identifier("Expense") }), formData, async ({ expenseId }, { actor }) => {
    await deleteExpense({ expenseId, actor });
    return { message: "Expense deleted" };
  });
}
