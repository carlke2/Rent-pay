"use server";

import { z } from "zod";
import { registerPaybillUrls, simulatePaybill } from "@/adapters/mpesa";
import type { ActionState } from "@/components/shared/action-types";
import { policySettingsSchema } from "@/core/policy";
import { previewPolicyChange, savePolicy } from "@/services/policies";
import { isoDate, requiredText, runAction, shillings } from "./run";

/** The policy editor sends full settings as JSON in a hidden field. */
const settingsField = z
  .string({ error: "Settings are missing" })
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Settings are not valid" });
      return z.NEVER;
    }
  })
  .pipe(policySettingsSchema);

const scopeField = z.string().optional().transform((value) => (value && value !== "account" ? value : null));

export async function previewPolicyAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ scope: scopeField, settings: settingsField }), formData, async ({ scope, settings }) => {
    const preview = await previewPolicyChange({ buildingId: scope, settings });
    return {
      message: "Preview ready",
      data: {
        leasesInScope: preview.leasesInScope,
        penaltiesNow: `${preview.penalties.current.leases} leases, KES ${preview.penalties.current.total.toLocaleString("en-KE")}`,
        penaltiesWithChange: `${preview.penalties.proposed.leases} leases, KES ${preview.penalties.proposed.total.toLocaleString("en-KE")}`,
        waterChargeChange: `KES ${preview.water.change.toLocaleString("en-KE")} on ${preview.water.readings.length} readings`,
        fixedChargesChangePerInvoice: `KES ${preview.fixedChargesPerInvoice.change.toLocaleString("en-KE")}`,
      },
    };
  }, { revalidate: false });
}

export async function savePolicyAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ scope: scopeField, settings: settingsField, effectiveFrom: isoDate("Effective date") }), formData, async (input, { actor }) => {
    await savePolicy({ buildingId: input.scope, effectiveFrom: input.effectiveFrom, settings: input.settings, actor });
    return { message: `Policy saved, effective ${input.effectiveFrom}` };
  });
}

export async function registerUrlsAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({}), formData, async () => {
    const response = await registerPaybillUrls();
    return { message: "Paybill URLs registered", data: { ...response } };
  });
}

export async function simulatePaybillAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ unitCode: requiredText("Unit code", 20), amount: shillings() }), formData, async (input) => {
    const response = await simulatePaybill({ amount: input.amount, billReference: input.unitCode });
    return { message: "Simulated payment sent", data: { ...response } };
  });
}
