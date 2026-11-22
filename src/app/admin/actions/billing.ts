"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { confirmMeterReading, generateInvoices, saveMeterReadings, waiveCharge } from "@/services/billing";
import { billingPeriod, checkbox, identifier, requiredText, runAction, shillings } from "./run";

export async function generateInvoicesAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ period: billingPeriod, dryRun: checkbox }), formData, async ({ period, dryRun }) => {
    const result = await generateInvoices({ period, dryRun });
    return {
      message: dryRun ? `Preview: ${result.created} invoices` : `${result.created} invoices created`,
      data: result as unknown as Record<string, unknown>,
    };
  });
}

export async function waiveChargeAction(_state: ActionState, formData: FormData) {
  const schema = z.object({ invoiceLineId: identifier("Charge"), amount: shillings(), reason: requiredText("Reason", 200) });
  return runAction(schema, formData, async (input, { actor }) => {
    await waiveCharge({ ...input, actor });
    return { message: "Charge waived" };
  });
}

export async function saveMeterReadingsAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    period: billingPeriod,
    unitIds: z.array(z.uuid()).default([]),
    readings: z.array(z.string()).default([]),
  });
  return runAction(schema, formData, async ({ period, unitIds, readings }, { actor }) => {
    // Only rows with a value are saved; empty inputs are left for later.
    const entries = unitIds
      .map((unitId, index) => ({ unitId, raw: readings[index] ?? "" }))
      .filter((entry) => entry.raw.trim() !== "");
    const invalid = entries.findIndex((entry) => !/^\d+$/.test(entry.raw.trim()));
    if (invalid >= 0) throw new z.ZodError([{ code: "custom", path: [`reading.${entries[invalid]?.unitId}`], message: "Whole number", input: entries[invalid]?.raw }]);
    if (entries.length === 0) throw new z.ZodError([{ code: "custom", path: ["form"], message: "Enter at least one reading", input: null }]);
    const saved = await saveMeterReadings({ period, readings: entries.map((entry) => ({ unitId: entry.unitId, currentReading: Number(entry.raw) })), actor });
    const flagged = saved.filter((reading) => reading.flagged).length;
    return { message: `${saved.length} readings saved${flagged ? `, ${flagged} flagged for checking` : ""}` };
  });
}

export async function confirmMeterReadingAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ readingId: identifier("Reading") }), formData, async ({ readingId }, { actor }) => {
    await confirmMeterReading({ readingId, actor });
    return { message: "Reading confirmed" };
  });
}

