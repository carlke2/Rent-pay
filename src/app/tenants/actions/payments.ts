"use server";

import { z } from "zod";
import type { ActionState } from "@/components/shared/action-types";
import { getPaymentProgress } from "@/services/portal";
import { getPaymentRequestStatus, refreshStkStatus, startStkPush, submitPaymentClaim } from "@/services/payments";
import { isIsoDate } from "@/utilities/dates";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { currentTenantLease } from "../current-lease";
import { runTenantAction } from "./run";

/** M-Pesa's per-transaction ceiling. */
const MAXIMUM_AMOUNT = 250_000;

export async function startPaymentAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    amount: z.coerce
      .number({ error: "Enter an amount" })
      .int("Use whole shillings, no cents")
      .min(1, "The smallest amount is KES 1")
      .max(MAXIMUM_AMOUNT, "M-Pesa allows up to KES 250,000 per payment"),
    phone: z.string({ error: "Enter your M-Pesa number" }).refine((value) => normaliseKenyanPhone(value) !== null, "Enter a Safaricom number like 0712 345 678"),
  });
  return runTenantAction(schema, formData, async ({ amount, phone }, { lease }) => {
    if (!lease.isCurrent) return { message: "This lease has ended, so it can't take payments here." };
    const { requestId } = await startStkPush({ amount, phone: normaliseKenyanPhone(phone) as string });
    return { data: { requestId, amount } };
  });
}

const CHECK_AFTER_MILLISECONDS = 60_000;
const CHECK_INTERVAL_MILLISECONDS = 15_000;

/** Polled every 3 seconds by the pay screen. After 60 seconds it also asks Daraja directly (at most every 15 s). */
export async function checkPaymentAction(requestId: string) {
  const { tenantId } = await currentTenantLease();
  if (!z.uuid().safeParse(requestId).success) return null;
  const request = await getPaymentRequestStatus(requestId);
  if (!request || request.tenantId !== tenantId) return null;
  const now = Date.now();
  if (
    request.status === "pending" &&
    now - request.createdAt.getTime() > CHECK_AFTER_MILLISECONDS &&
    (!request.lastCheckedAt || now - request.lastCheckedAt.getTime() > CHECK_INTERVAL_MILLISECONDS)
  ) {
    try {
      await refreshStkStatus(requestId);
    } catch (error) {
      console.error("STK status check failed", error);
    }
  }
  const progress = await getPaymentProgress(tenantId, requestId);
  if (!progress) return null;
  return {
    status: progress.status,
    amount: progress.amount,
    mpesaReceipt: progress.mpesaReceipt,
    receiptToken: progress.receiptToken,
    balance: progress.balance,
    reason: progress.reason,
  };
}

export type PaymentProgress = NonNullable<Awaited<ReturnType<typeof checkPaymentAction>>>;

const SLIP_LIMIT = 5 * 1024 * 1024;

export async function reportPaymentAction(_state: ActionState, formData: FormData) {
  const schema = z.object({
    amount: z.coerce.number({ error: "Enter the amount you paid" }).int("Use whole shillings, no cents").min(1, "Enter the amount you paid"),
    paidOn: z.string({ error: "Choose the date you paid" }).refine(isIsoDate, "Choose the date you paid"),
    method: z.enum(["bank", "cash"], { error: "Choose bank or cash" }),
    reference: z.string().trim().max(60, "That reference is too long").optional(),
    slip: z
      .instanceof(File)
      .refine((file) => file.type.startsWith("image/"), "The slip must be a photo")
      .refine((file) => file.size <= SLIP_LIMIT, "The photo must be 5 MB or smaller")
      .optional(),
  });
  return runTenantAction(schema, formData, async (input, { lease, actor }) => {
    await submitPaymentClaim({
      leaseId: lease.leaseId,
      amount: input.amount,
      paidOn: input.paidOn,
      method: input.method,
      reference: input.reference ?? null,
      slipFile: input.slip ? { bytes: new Uint8Array(await input.slip.arrayBuffer()) } : null,
      actor,
    });
    return { message: "Sent to your landlord. You'll get an SMS once it's confirmed." };
  });
}
