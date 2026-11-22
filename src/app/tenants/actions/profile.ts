"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { confirmPhoneChange, requestPhoneChange, setWhatsappOptIn } from "@/services/portal";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { runTenantAction } from "./run";

const phoneFields = {
  field: z.enum(["phone", "alternativePhone"], { error: "Choose which number to change" }),
  newPhone: z.string({ error: "Enter the new number" }).refine((value) => normaliseKenyanPhone(value) !== null, "Enter a Kenyan mobile number like 0712 345 678"),
};

export async function requestPhoneChangeAction(_state: ActionState, formData: FormData) {
  return runTenantAction(z.object(phoneFields), formData, async ({ field, newPhone }, { tenantId }) => {
    const { phone } = await requestPhoneChange({ tenantId, field, newPhone });
    return { message: "Code sent to the new number", data: { field, phone, sentAt: Date.now() } };
  });
}

export async function confirmPhoneChangeAction(_state: ActionState, formData: FormData) {
  const schema = z.object({ ...phoneFields, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
  return runTenantAction(schema, formData, async (input, { tenantId }) => {
    await confirmPhoneChange({ tenantId, ...input });
    return { message: "Phone number updated", data: { done: true } };
  });
}

export async function setWhatsappAction(_state: ActionState, formData: FormData) {
  return runTenantAction(z.object({ optIn: z.enum(["true", "false"]) }), formData, async ({ optIn }, { tenantId }) => {
    await setWhatsappOptIn(tenantId, optIn === "true");
    return { message: optIn === "true" ? "WhatsApp messages turned on" : "WhatsApp messages turned off" };
  });
}
