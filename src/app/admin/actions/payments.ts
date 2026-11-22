"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { ServiceError } from "@/services/errors";
import { sendManualReminder, sendStatementLink } from "@/services/notifications";
import {
  assignUnmatchedPayment,
  confirmPaymentClaim,
  reconcileStatement,
  recordManualPayment,
  rejectPaymentClaim,
  reversePayment,
} from "@/services/payments";
import { identifier, isoDate, optionalText, requiredText, runAction, shillings } from "./run";

export async function assignPaymentAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ paymentId: identifier("Payment"), leaseId: identifier("Lease") }), formData, async (input, { actor }) => {
    await assignUnmatchedPayment({ ...input, actor });
    return { message: "Payment assigned and receipt sent" };
  });
}

export async function confirmClaimAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ claimId: identifier("Claim") }), formData, async (input, { actor }) => {
    await confirmPaymentClaim({ ...input, actor });
    return { message: "Claim confirmed and payment recorded" };
  });
}

export async function rejectClaimAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ claimId: identifier("Claim"), reason: requiredText("Reason", 200) }), formData, async (input, { actor }) => {
    await rejectPaymentClaim({ ...input, actor });
    return { message: "Claim rejected; the tenant has been told why" };
  });
}

export async function reversePaymentAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ paymentId: identifier("Payment"), reason: requiredText("Reason", 200) }), formData, async (input, { actor }) => {
    await reversePayment({ ...input, actor });
    return { message: "Payment reversed" };
  });
}

export async function recordPaymentAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    leaseId: identifier("Lease"),
    amount: shillings(),
    paidOn: isoDate("Payment date"),
    method: z.enum(["bank", "cash"], { error: "Choose bank or cash" }),
    reference: optionalText(60),
  });
  return runAction(schema, formData, async (input, { actor }) => {
    await recordManualPayment({ ...input, actor });
    return { message: "Payment recorded and receipt sent" };
  });
}

const REMINDER_MESSAGES = {
  sent: "Reminder sent",
  already_sent_today: "Reminder sent today",
  nothing_owed: "Nothing is owed, so no reminder was sent",
  not_found: "This lease is not current",
  skipped: "Quiet hours: try again after 7:00",
  failed: "The SMS could not be sent",
} as const;

/** "Send reminder": texts the tenant the reminder SMS with their bill link. Once per lease per day. */
export async function sendReminderAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ leaseId: identifier("Lease") }), formData, async ({ leaseId }) => {
    const { status } = await sendManualReminder(leaseId);
    if (status !== "sent") throw new ServiceError(REMINDER_MESSAGES[status]);
    return { message: REMINDER_MESSAGES[status] };
  });
}

export async function reconcileAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    file: z.instanceof(File, { error: "Choose the statement CSV" }).refine((file) => file.size <= 5 * 1024 * 1024, "The file must be 5 MB or smaller"),
  });
  return runAction(schema, formData, async ({ file }, { actor }) => {
    const summary = await reconcileStatement({ csvText: await file.text(), actor });
    return {
      message: `${summary.imported} imported, ${summary.alreadyRecorded} already recorded`,
      data: {
        rowsRead: summary.rowsRead,
        imported: summary.imported,
        unmatched: summary.unmatched,
        alreadyRecorded: summary.alreadyRecorded,
        notPaidIn: summary.notPaidIn,
        unreadableRows: summary.unreadableRows.map((row) => ({ line: `Line ${row.line}`, reason: row.reason })),
      },
    };
  });
}

export async function sendStatementAction(_state: ActionState, formData: FormData) {
  return runAction(z.object({ leaseId: identifier("Lease") }), formData, async ({ leaseId }) => {
    const { status } = await sendStatementLink(leaseId);
    return { message: status === "sent" ? "Statement sent by SMS" : status === "skipped" ? "Quiet hours: try again after 7:00" : "The SMS could not be sent" };
  });
}
