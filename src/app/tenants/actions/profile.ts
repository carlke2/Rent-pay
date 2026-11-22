"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { AVATAR_MAX_BYTES, removeTenantAvatar, setTenantAvatar } from "@/services/avatars";
import { ServiceError } from "@/services/errors";
import { confirmPhoneChange, requestPhoneChange, setWhatsappOptIn } from "@/services/portal";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { currentTenantLease } from "../current-lease";
import { runTenantAction } from "./run";
import { logError } from "@/utilities/log";

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

/** Profile photo: the browser has already resized it; the server re-validates and normalises it (see services/avatars). */
export async function uploadAvatarAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const { tenantId } = await currentTenantLease();
  const at = Date.now();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a photo first.", at };
  if (file.size > AVATAR_MAX_BYTES) return { status: "error", message: "The photo must be 4 MB or smaller.", at };
  try {
    const url = await setTenantAvatar(tenantId, new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/tenants", "layout");
    revalidatePath("/admin/tenants", "layout");
    return { status: "success", message: "Photo updated", data: { url }, at };
  } catch (error) {
    if (error instanceof ServiceError) return { status: "error", message: error.message, at };
    logError("Avatar upload failed", error);
    return { status: "error", message: "We couldn't save your photo. Please try again.", at };
  }
}

export async function removeAvatarAction(_state: ActionState, _formData: FormData): Promise<ActionState> {
  const { tenantId } = await currentTenantLease();
  const at = Date.now();
  try {
    await removeTenantAvatar(tenantId, `tenant:${tenantId}`);
    revalidatePath("/tenants", "layout");
    revalidatePath("/admin/tenants", "layout");
    return { status: "success", message: "Photo removed", at };
  } catch (error) {
    if (error instanceof ServiceError) return { status: "error", message: error.message, at };
    logError("Avatar removal failed", error);
    return { status: "error", message: "We couldn't remove your photo. Please try again.", at };
  }
}
