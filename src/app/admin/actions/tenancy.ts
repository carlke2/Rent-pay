"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { removeTenantAvatar } from "@/services/avatars";
import { changeRent, giveNotice, moveIn, moveOut, previewMoveIn, previewMoveOut, recordDepositRefund } from "@/services/tenancy";
import { identifier, isoDate, optionalText, requiredText, runAction, shillings, wholeNumber } from "./run";

export async function giveNoticeAction(_state: ActionState, formData: FormData) {
  const schema = z.object({ leaseId: identifier("Lease"), noticeDate: isoDate("Notice date"), moveOutDate: isoDate("Move-out date"), reason: optionalText() });
  return runAction(schema, formData, async (input, { actor }) => {
    await giveNotice({ ...input, actor });
    return { message: "Notice recorded" };
  });
}

export async function changeRentAction(_state: ActionState, formData: FormData) {
  const schema = z.object({ leaseId: identifier("Lease"), amount: shillings("Rent", 0), effectiveFrom: isoDate("Start date"), reason: optionalText() });
  return runAction(schema, formData, async (input, { actor }) => {
    await changeRent({ ...input, actor });
    return { message: "Rent change saved" };
  });
}

export async function depositRefundAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    leaseId: identifier("Lease"),
    amount: shillings("Amount"),
    method: requiredText("Method", 40),
    reference: optionalText(60),
    refundedOn: isoDate("Refund date"),
  });
  return runAction(schema, formData, async (input, { actor }) => {
    await recordDepositRefund({ ...input, actor });
    return { message: "Deposit refund recorded" };
  });
}

const moveInSchema = z.object({
  unitId: identifier("Unit"),
  fullName: requiredText("Full name", 120),
  phone: requiredText("Phone", 20),
  nationalId: optionalText(30),
  alternativePhone: optionalText(20),
  startDate: isoDate("Start date"),
  rentAmount: shillings("Rent", 0),
  depositAmount: shillings("Deposit", 0),
  openingReading: wholeNumber("Opening reading").optional(),
});

function moveInInput(input: z.output<typeof moveInSchema>) {
  return {
    unitId: input.unitId,
    tenant: { fullName: input.fullName, phone: input.phone, nationalId: input.nationalId ?? null, alternativePhone: input.alternativePhone ?? null },
    startDate: input.startDate,
    rentAmount: input.rentAmount,
    depositAmount: input.depositAmount,
    openingReading: input.openingReading ?? null,
  };
}

export async function previewMoveInAction(_state: ActionState, formData: FormData) {
  return runAction(moveInSchema, formData, async (input) => {
    const preview = await previewMoveIn(moveInInput(input));
    return {
      message: "Review the first invoice",
      data: { tenantIsNew: preview.tenantCreated, lines: preview.lines, invoiceNumber: preview.invoice?.number ?? null },
    };
  }, { revalidate: false });
}

export async function moveInAction(_state: ActionState, formData: FormData) {
  let unitId = "";
  const result = await runAction(moveInSchema, formData, async (input, { actor }) => {
    await moveIn({ ...moveInInput(input), actor });
    unitId = input.unitId;
    return { message: "Moved in. Welcome SMS sent." };
  });
  if (result.status === "success") redirect(`/admin/units/${unitId}?moved=in`);
  return result;
}

const moveOutSchema = z.object({
  leaseId: identifier("Lease"),
  moveOutDate: isoDate("Move-out date"),
  finalReading: wholeNumber("Final reading").optional(),
  descriptions: z.array(z.string().trim()).default([]),
  amounts: z.array(z.string()).default([]),
});

function moveOutInput(input: z.output<typeof moveOutSchema>) {
  const deductions = input.descriptions
    .map((description, index) => ({ description, amount: Number(input.amounts[index] ?? 0) }))
    .filter((item) => item.description || item.amount);
  for (const [index, item] of deductions.entries()) {
    if (!item.description) throw new z.ZodError([{ code: "custom", path: [`deductions.${index}`], message: "Describe the deduction", input: item }]);
    if (!Number.isSafeInteger(item.amount) || item.amount < 1) {
      throw new z.ZodError([{ code: "custom", path: [`deductions.${index}`], message: "Amount must be a whole number of at least 1", input: item }]);
    }
  }
  return { leaseId: input.leaseId, moveOutDate: input.moveOutDate, finalReading: input.finalReading ?? null, deductions };
}

export async function previewMoveOutAction(_state: ActionState, formData: FormData) {
  return runAction(moveOutSchema, formData, async (input) => ({
    message: "Review the deposit summary",
    data: await previewMoveOut(moveOutInput(input)),
  }), { revalidate: false });
}

export async function moveOutAction(_state: ActionState, formData: FormData) {
  let unitPath = "/admin/buildings";
  const result = await runAction(moveOutSchema, formData, async (input, { actor }) => {
    const summary = await moveOut({ ...moveOutInput(input), actor });
    unitPath = `/admin/units/${summary.unitId}?moved=out`;
    return { message: "Moved out. Final statement sent." };
  });
  if (result.status === "success") redirect(unitPath);
  return result;
}

/** The landlord can remove a tenant's photo (e.g. an inappropriate one) but never upload one for them. */
export async function removeTenantAvatarAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ tenantId: identifier("Tenant") }), formData, async ({ tenantId }, { actor }) => {
    await removeTenantAvatar(tenantId, actor);
    return { message: "Photo removed" };
  });
}
