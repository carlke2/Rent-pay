"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { createBuilding, createUnit, updateBuilding, updateTenant, updateUnit } from "@/services/tenancy";
import { checkbox, identifier, optionalText, requiredText, runAction, shillings, wholeNumber } from "./run";

const buildingSchema = z.object({
  name: requiredText("Name", 80),
  location: optionalText(120),
  codePrefix: requiredText("Code prefix", 8).regex(/^[A-Za-z0-9]+$/, "Letters and digits only"),
});

export async function createBuildingAction(_state: ActionState, formData: FormData) {
  return runAction(buildingSchema, formData, async (input, { actor }) => {
    const building = await createBuilding({ ...input, actor });
    return { message: `${building?.name} added` };
  });
}

export async function updateBuildingAction(_state: ActionState, formData: FormData) {
  return runAction(buildingSchema.extend({ buildingId: identifier("Building") }), formData, async ({ buildingId, ...changes }, { actor }) => {
    await updateBuilding({ buildingId, changes: { ...changes, location: changes.location ?? null }, actor });
    return { message: "Building saved" };
  });
}

const unitFields = {
  code: requiredText("Unit code", 12),
  type: requiredText("Type", 60),
  floor: wholeNumber("Floor", -5).optional(),
  rentAmount: shillings("Rent", 0),
  depositAmount: shillings("Deposit", 0).optional(),
  meterNumber: optionalText(40),
};

export async function createUnitAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ buildingId: identifier("Building"), ...unitFields }), formData, async (input, { actor }) => {
    const unit = await createUnit({ ...input, actor });
    return { message: `Unit ${unit?.code} added` };
  });
}

export async function updateUnitAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    unitId: identifier("Unit"),
    ...unitFields,
    status: z.enum(["", "vacant", "reserved", "under_repair"]).optional(),
    reason: optionalText(200),
  });
  return runAction(schema, formData, async ({ unitId, status, reason, ...changes }, { actor }) => {
    await updateUnit({
      unitId,
      changes: { ...changes, floor: changes.floor ?? null, meterNumber: changes.meterNumber ?? null, ...(status ? { status } : {}) },
      actor,
      reason,
    });
    return { message: "Unit saved" };
  });
}

export async function updateTenantAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    tenantId: identifier("Tenant"),
    fullName: requiredText("Full name", 120),
    phone: requiredText("Phone", 20),
    nationalId: optionalText(30),
    alternativePhone: optionalText(20),
    whatsappOptIn: checkbox,
    portalAccess: checkbox,
    nextOfKinName: optionalText(120),
    nextOfKinPhone: optionalText(20),
  });
  return runAction(schema, formData, async ({ tenantId, nextOfKinName, nextOfKinPhone, ...changes }, { actor }) => {
    await updateTenant({
      tenantId,
      changes: {
        ...changes,
        nationalId: changes.nationalId ?? null,
        alternativePhone: changes.alternativePhone ?? null,
        nextOfKin: nextOfKinName && nextOfKinPhone ? { name: nextOfKinName, phone: nextOfKinPhone } : null,
      },
      actor,
    });
    return { message: "Tenant saved" };
  });
}
