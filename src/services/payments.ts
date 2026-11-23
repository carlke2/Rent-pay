import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import {
  DarajaError,
  paybillCallbackSchema,
  stkCallbackSchema,
  stkPush,
  stkStatus,
  STK_RESULT_CODES,
  STK_STILL_PROCESSING_ERROR_CODE,
} from "@/adapters/mpesa";
import { paymentEntry } from "@/core/ledger";
import { isPaidByOther, matchPayment, normaliseUnitCode, RECENTLY_ENDED_DAYS } from "@/core/payments";
import { getDatabase, type Transaction } from "@/database/client";
import { fetchKeysetPage, fetchOffsetPage, type KeysetKey, windowTotal } from "@/database/keyset";
import {
  allocations,
  auditLog,
  buildings,
  landlord,
  invoiceLines,
  invoices,
  ledgerEntries,
  leases,
  paymentCallbacks,
  paymentClaims,
  paymentRequests,
  payments,
  receipts,
  tenants,
  units,
} from "@/database/schema";
import { getStorage, inspectSlip } from "@/adapters/storage";
import { requireTenant } from "@/authentication/roles";
import { addDays, assertIsoDate, parseMpesaTimestamp, startOfNairobiDay, toNairobiDate, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { assertShillings, parseShillings } from "@/utilities/money";
import { uniqueShortCode } from "@/utilities/short-codes";
import { applyCredit } from "./billing";
import { assertDateOpen } from "./closed-periods";
import { ServiceError } from "./errors";
import { writeAudit } from "./audit";
import {
  notifyClaimRejected,
  notifyLandlordClaim,
  notifyLandlordUnmatched,
  notifyPaymentReversed,
  notifyTenantClaimReceived,
  sendReceipt,
  sendStkIncomplete,
} from "./notifications";
import { logError } from "@/utilities/log";
import type { PageRequest } from "@/utilities/pagination";

export type PaymentChannel = "stk" | "paybill" | "bank" | "cash";
export type CallbackKind = "stk" | "paybill_validation" | "paybill_confirmation";
type PaymentRequestStatus = "pending" | "paid" | "failed" | "cancelled" | "timed_out";

const CURRENT_LEASE_STATUSES = ["active", "notice"] as const;

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/**
 * Marks the landlord overview stale after money moves, so the next visit (and the 30-second refresh) shows it.
 * Outside a request (seed script, background job) there is nothing to revalidate, so that case is ignored.
 */
function refreshLandlordScreens() {
  try {
    revalidatePath("/admin");
    revalidateTag("admin-shell", "max");
  } catch {
    // No request context: nothing cached to refresh.
  }
}

/** Stores a raw Daraja callback. Always the first thing a callback route does. */
export async function storeCallback(kind: CallbackKind, payload: unknown): Promise<string> {
  const [row] = await getDatabase()
    .insert(paymentCallbacks)
    // Validation callbacks need no further processing, so they are complete once stored.
    .values({ kind, payload: payload ?? {}, processedAt: kind === "paybill_validation" ? new Date() : null })
    .returning({ id: paymentCallbacks.id });
  if (!row) throw new Error("Callback insert returned no row");
  return row.id;
}

/**
 * Paybill validation: is there a unit with this code and a current or recently ended lease?
 * One indexed query (units.normalised_code is unique; leases.unit_id is indexed).
 */
export async function isPayableAccount(billReference: string): Promise<boolean> {
  const code = normaliseUnitCode(billReference);
  if (!code) return false;
  const cutoff = addDays(todayInNairobi(), -RECENTLY_ENDED_DAYS);
  const [row] = await getDatabase()
    .select({ id: leases.id })
    .from(units)
    .innerJoin(leases, eq(leases.unitId, units.id))
    .where(and(eq(units.normalisedCode, code), or(ne(leases.status, "ended"), sql`${leases.endDate} >= ${cutoff}`)))
    .limit(1);
  return Boolean(row);
}

/** Processes a stored callback. Idempotent: already-processed callbacks are skipped. */
export async function processCallback(callbackId: string): Promise<{ skipped: boolean }> {
  const database = getDatabase();
  const [callback] = await database.select().from(paymentCallbacks).where(eq(paymentCallbacks.id, callbackId)).limit(1);
  if (!callback) throw new Error(`Callback ${callbackId} not found`);
  if (callback.processedAt) return { skipped: true };

  try {
    if (callback.kind === "stk") await handleStkResult(callback.payload);
    else if (callback.kind === "paybill_confirmation") await handlePaybillConfirmation(callback.payload);
    // paybill_validation needs no processing; it is stored for the record.

    await database
      .update(paymentCallbacks)
      .set({ processedAt: new Date(), error: null })
      .where(eq(paymentCallbacks.id, callbackId));
    return { skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database
      .update(paymentCallbacks)
      .set({ error: message.slice(0, 2000) })
      .where(eq(paymentCallbacks.id, callbackId))
      .catch((updateError: unknown) => logError("Could not save callback error", updateError));
    throw error;
  }
}

function metadataValue(
  items: { Name: string; Value?: string | number }[] | undefined,
  name: string,
): string | number | undefined {
  return items?.find((item) => item.Name === name)?.Value;
}

async function handleStkResult(payload: unknown): Promise<void> {
  const callback = stkCallbackSchema.parse(payload).Body.stkCallback;
  const database = getDatabase();

  const [request] = await database
    .select({
      id: paymentRequests.id,
      leaseId: paymentRequests.leaseId,
      phone: paymentRequests.phone,
      amount: paymentRequests.amount,
      initiatedBy: paymentRequests.initiatedBy,
      unitCode: units.code,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(paymentRequests.checkoutRequestId, callback.CheckoutRequestID))
    .limit(1);
  if (!request) throw new Error(`No payment request for CheckoutRequestID ${callback.CheckoutRequestID}`);

  const resultCode = String(callback.ResultCode);

  if (callback.ResultCode !== STK_RESULT_CODES.success) {
    const status: PaymentRequestStatus =
      callback.ResultCode === STK_RESULT_CODES.cancelled
        ? "cancelled"
        : callback.ResultCode === STK_RESULT_CODES.timedOut
          ? "timed_out"
          : "failed";
    await database
      .update(paymentRequests)
      .set({ status, resultCode, resultDescription: callback.ResultDesc })
      .where(and(eq(paymentRequests.id, request.id), ne(paymentRequests.status, "paid")));
    return;
  }

  const items = callback.CallbackMetadata?.Item;
  const receipt = metadataValue(items, "MpesaReceiptNumber");
  const amount = metadataValue(items, "Amount");
  if (!receipt || amount === undefined) throw new Error("Successful STK callback is missing the receipt number or amount");
  const transactionDate = metadataValue(items, "TransactionDate");
  const phone = metadataValue(items, "PhoneNumber");

  const recorded = await recordPayment({
    channel: "stk",
    mpesaReceipt: String(receipt),
    amount: parseShillings(String(amount)),
    accountReference: request.unitCode,
    payerName: null,
    payerPhone: phone !== undefined ? String(phone) : request.phone,
    paidAt: transactionDate !== undefined ? parseMpesaTimestamp(transactionDate) : new Date(),
    leaseId: request.leaseId,
    promptPhone: request.phone,
    raw: payload,
  });

  await database
    .update(paymentRequests)
    .set({ status: "paid", resultCode, resultDescription: callback.ResultDesc, paymentId: recorded.paymentId })
    .where(eq(paymentRequests.id, request.id));
}

async function handlePaybillConfirmation(payload: unknown): Promise<void> {
  const confirmation = paybillCallbackSchema.parse(payload);
  const paidAt = parseMpesaTimestamp(confirmation.TransTime);
  const match = await matchByAccount(confirmation.BillRefNumber, toNairobiDate(paidAt));

  await recordPayment({
    channel: "paybill",
    mpesaReceipt: confirmation.TransID,
    amount: parseShillings(confirmation.TransAmount),
    accountReference: confirmation.BillRefNumber,
    payerName: confirmation.FirstName ?? null,
    payerPhone: confirmation.MSISDN ?? null,
    paidAt,
    leaseId: match.leaseId,
    raw: payload,
  });
}

/** The matching ladder for a Paybill account number: current lease for the unit, else a recently ended one. */
export async function matchByAccount(accountReference: string, paidOn: string) {
  const code = normaliseUnitCode(accountReference);
  const candidates = code
    ? await getDatabase()
        .select({ leaseId: leases.id, unitCode: units.code, status: leases.status, endDate: leases.endDate })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(units.normalisedCode, code))
    : [];
  return matchPayment({ accountReference, paidOn, paymentRequests: [], leases: candidates });
}

// ---------------------------------------------------------------------------
// Recording and posting
// ---------------------------------------------------------------------------

export type RecordPaymentInput = {
  channel: PaymentChannel;
  /** Null only for bank and cash. */
  mpesaReceipt: string | null;
  amount: number;
  accountReference: string | null;
  payerName: string | null;
  payerPhone: string | null;
  paidAt: Date;
  leaseId: string | null;
  raw: unknown;
  /** Bank or cash reference; used as the ledger reference when there is no M-Pesa receipt. */
  reference?: string | null;
  /** STK push only: the phone the prompt was sent to, compared with the tenant's phones. */
  promptPhone?: string | null;
};

export type RecordPaymentResult = { paymentId: string; duplicate: boolean; matched: boolean };

/**
 * Records a payment in one transaction: the payment, its allocations, the ledger entry and the receipt.
 * A repeated M-Pesa receipt number is a duplicate callback: the existing payment is returned untouched.
 * Notifications go out after the transaction commits.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  assertShillings(input.amount, "payment amount");
  if (input.amount < 1) throw new RangeError("payment amount must be at least 1");

  const result = await getDatabase().transaction(async (transaction): Promise<RecordPaymentResult> => {
    const [inserted] = await transaction
      .insert(payments)
      .values({
        mpesaReceipt: input.mpesaReceipt,
        channel: input.channel,
        amount: input.amount,
        accountReference: input.accountReference,
        payerName: input.payerName,
        payerPhone: input.payerPhone,
        paidAt: input.paidAt,
        leaseId: input.leaseId,
        matchStatus: input.leaseId ? "matched" : "unmatched",
        raw: input.raw ?? null,
      })
      .onConflictDoNothing({ target: payments.mpesaReceipt })
      .returning({ id: payments.id });

    if (!inserted) {
      if (!input.mpesaReceipt) throw new Error("Payment insert returned no row");
      const [existing] = await transaction
        .select({ id: payments.id, matchStatus: payments.matchStatus })
        .from(payments)
        .where(eq(payments.mpesaReceipt, input.mpesaReceipt))
        .limit(1);
      if (!existing) throw new Error(`Duplicate receipt ${input.mpesaReceipt} but no existing payment found`);
      return { paymentId: existing.id, duplicate: true, matched: existing.matchStatus === "matched" };
    }

    if (!input.leaseId) return { paymentId: inserted.id, duplicate: false, matched: false };

    await postPaymentToLease(transaction, {
      paymentId: inserted.id,
      leaseId: input.leaseId,
      amount: input.amount,
      paidAt: input.paidAt,
      reference: input.mpesaReceipt ?? input.reference ?? null,
      promptPhone: input.promptPhone ?? null,
    });
    return { paymentId: inserted.id, duplicate: false, matched: true };
  });

  if (!result.duplicate) {
    if (result.matched) await sendReceipt(result.paymentId);
    else await notifyLandlordUnmatched(result.paymentId);
    refreshLandlordScreens();
  }
  return result;
}

/**
 * Posts a payment to a lease inside an open transaction: writes the ledger credit, creates the receipt,
 * marks the payment matched (noting whether someone other than the tenant paid), then applyCredit allocates
 * it to open invoice lines (the one allocation path). Anything left over stays as credit because balances
 * come from the ledger.
 */
async function postPaymentToLease(
  transaction: Transaction,
  input: { paymentId: string; leaseId: string; amount: number; paidAt: Date; reference: string | null; promptPhone?: string | null },
): Promise<{ receiptId: string; receiptNumber: string }> {
  // Lock the lease so two payments for it can't allocate the same open line at once.
  const [lease] = await transaction
    .select({ id: leases.id, tenantName: tenants.fullName, tenantPhone: tenants.phone, alternativePhone: tenants.alternativePhone })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(eq(leases.id, input.leaseId))
    .for("update", { of: leases });
  if (!lease) throw new Error(`Lease ${input.leaseId} not found`);
  const [payment] = await transaction
    .select({ channel: payments.channel, payerName: payments.payerName })
    .from(payments)
    .where(eq(payments.id, input.paymentId));
  if (!payment) throw new Error(`Payment ${input.paymentId} not found`);
  const paidByOther = isPaidByOther({
    channel: payment.channel,
    payerName: payment.payerName,
    promptPhone: input.promptPhone ?? null,
    tenant: { fullName: lease.tenantName, phone: lease.tenantPhone, alternativePhone: lease.alternativePhone },
  });
  const paidOn = toNairobiDate(input.paidAt);

  const [sequenceRow] = await transaction.execute<{ value: string }>(
    sql`select nextval(pg_get_serial_sequence('receipts', 'sequence')) as value`,
  );
  const sequence = Number(sequenceRow?.value);
  if (!Number.isSafeInteger(sequence)) throw new Error("Could not get the next receipt number");
  const receiptNumber = `RCT-${String(sequence).padStart(6, "0")}`;

  await transaction.insert(ledgerEntries).values(
    paymentEntry({
      leaseId: lease.id,
      entryDate: paidOn,
      paymentId: input.paymentId,
      reference: input.reference ?? receiptNumber,
      amount: input.amount,
      account: "rent",
    }),
  );

  const shortCode = await uniqueShortCode(10, async (code) => {
    const [existing] = await transaction
      .select({ id: receipts.id })
      .from(receipts)
      .where(eq(receipts.shortCode, code))
      .limit(1);
    return existing !== undefined;
  });
  const [receipt] = await transaction
    .insert(receipts)
    .values({
      sequence,
      number: receiptNumber,
      paymentId: input.paymentId,
      token: randomBytes(32).toString("base64url"),
      shortCode,
    })
    .returning({ id: receipts.id });
  if (!receipt) throw new Error("Receipt insert returned no row");

  await transaction
    .update(payments)
    .set({ leaseId: lease.id, matchStatus: "matched", paidByOther })
    .where(eq(payments.id, input.paymentId));

  await applyCredit(lease.id, transaction);
  return { receiptId: receipt.id, receiptNumber };
}

/** Posts an unmatched payment to a lease chosen by the landlord, with an audit_log row. */
export async function assignUnmatchedPayment(input: { paymentId: string; leaseId: string; actor: string }): Promise<void> {
  await getDatabase().transaction(async (transaction) => {
    const [payment] = await transaction
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .for("update");
    if (!payment) throw new Error("Payment not found");
    if (payment.matchStatus !== "unmatched") throw new Error("This payment has already been assigned");

    const posted = await postPaymentToLease(transaction, {
      paymentId: payment.id,
      leaseId: input.leaseId,
      amount: payment.amount,
      paidAt: payment.paidAt,
      reference: payment.mpesaReceipt,
    });

    await transaction.insert(auditLog).values({
      actor: input.actor,
      action: "payment.assign",
      entity: "payment",
      entityId: payment.id,
      before: { matchStatus: payment.matchStatus, leaseId: payment.leaseId },
      after: { matchStatus: "matched", leaseId: input.leaseId, receiptNumber: posted.receiptNumber },
      reason: "Unmatched payment assigned by landlord",
    });
  });

  await sendReceipt(input.paymentId);
  refreshLandlordScreens();
}

// ---------------------------------------------------------------------------
// STK push
// ---------------------------------------------------------------------------

export class PaymentRequestError extends ServiceError {}

/**
 * Sends an STK push for the signed-in tenant's own lease and saves a pending payment request.
 * Only a tenant session can start one: the lease comes from the session, never from the caller.
 */
export async function startStkPush(input: { amount: number; phone: string }): Promise<{
  requestId: string;
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
}> {
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new PaymentRequestError("Amount must be a whole number of at least 1 shilling");
  }

  const session = await requireTenant();
  const database = getDatabase();
  const [lease] = await database
    .select({ id: leases.id, status: leases.status, unitCode: units.code })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(eq(leases.tenantId, session.subject), session.leaseId ? eq(leases.id, session.leaseId) : undefined))
    .orderBy(sql`case when ${leases.status} = 'ended' then 1 else 0 end`, sql`${leases.startDate} desc`)
    .limit(1);
  // A lease on notice is still a current tenancy and can pay.
  if (!lease || !(CURRENT_LEASE_STATUSES as readonly string[]).includes(lease.status)) {
    throw new PaymentRequestError("This lease is not active");
  }

  const response = await stkPush({
    phone: input.phone,
    amount: input.amount,
    accountReference: lease.unitCode,
    description: "Rent",
  });

  const [request] = await database
    .insert(paymentRequests)
    .values({
      leaseId: lease.id,
      amount: input.amount,
      phone: input.phone,
      initiatedBy: "tenant",
      checkoutRequestId: response.checkoutRequestId,
      merchantRequestId: response.merchantRequestId,
      status: "pending",
    })
    .returning({ id: paymentRequests.id });
  if (!request) throw new Error("Payment request insert returned no row");

  return { requestId: request.id, ...response };
}

/**
 * Asks Daraja for the status of a pending STK request. Failures update the status.
 * A "success" without a callback stays pending: we never create a payment without a receipt number.
 */
export async function refreshStkStatus(requestId: string): Promise<PaymentRequestStatus> {
  const database = getDatabase();
  const [request] = await database
    .select({
      id: paymentRequests.id,
      leaseId: paymentRequests.leaseId,
      phone: paymentRequests.phone,
      amount: paymentRequests.amount,
      initiatedBy: paymentRequests.initiatedBy,
      status: paymentRequests.status,
      checkoutRequestId: paymentRequests.checkoutRequestId,
      unitCode: units.code,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(paymentRequests.id, requestId))
    .limit(1);
  if (!request) throw new Error(`Payment request ${requestId} not found`);
  if (request.status !== "pending") return request.status;

  const stillPending = and(eq(paymentRequests.id, requestId), eq(paymentRequests.status, "pending"));

  if (!request.checkoutRequestId) {
    const [updated] = await database
      .update(paymentRequests)
      .set({ status: "failed", resultDescription: "No checkout request ID", lastCheckedAt: new Date() })
      .where(stillPending)
      .returning({ status: paymentRequests.status });
    return updated?.status ?? "failed";
  }

  let result: { resultCode: number; resultDescription: string };
  try {
    result = await stkStatus(request.checkoutRequestId);
  } catch (error) {
    await database.update(paymentRequests).set({ lastCheckedAt: new Date() }).where(stillPending);
    if (error instanceof DarajaError && error.errorCode === STK_STILL_PROCESSING_ERROR_CODE) return "pending";
    throw error;
  }

  if (result.resultCode === STK_RESULT_CODES.success) {
    await database
      .update(paymentRequests)
      .set({
        lastCheckedAt: new Date(),
        resultCode: "0",
        resultDescription: "Paid per status check, awaiting callback",
      })
      .where(stillPending);
    return "pending";
  }

  const status: PaymentRequestStatus =
    result.resultCode === STK_RESULT_CODES.cancelled
      ? "cancelled"
      : result.resultCode === STK_RESULT_CODES.timedOut
        ? "timed_out"
        : "failed";
  const resultCode = String(result.resultCode);
  const [updated] = await database
    .update(paymentRequests)
    .set({
      status,
      resultCode,
      resultDescription: result.resultDescription,
      lastCheckedAt: new Date(),
    })
    .where(stillPending)
    .returning({ status: paymentRequests.status });
  // If nothing was updated, a callback won the race; report what it stored.
  if (!updated) {
    const [current] = await database
      .select({ status: paymentRequests.status })
      .from(paymentRequests)
      .where(eq(paymentRequests.id, requestId));
    return current?.status ?? status;
  }
  return updated.status;
}

/** Daraja status queries per run, and the pause between them, to stay under Daraja's rate limits. */
export const STK_CHECKS_PER_RUN = 10;
const STK_CHECK_GAP_MS = 1_000;

/** Daraja throttling: HTTP 429, or the 500.003.02 "spike arrest" / "system is busy" error. */
function isDarajaRateLimit(error: unknown): boolean {
  if (!(error instanceof DarajaError)) return false;
  if (error.status === 429 || error.errorCode === "500.003.02") return true;
  return /spike arrest|rate limit|quota|too many requests/i.test(error.message);
}

/**
 * Checks STK requests still pending two minutes after they were sent: at most 10 per run, 1 s apart,
 * least recently checked first. A Daraja rate-limit response stops the run (logged once, not an error);
 * the rest wait for the next run. Also sends deferred tenant incomplete SMS.
 */
export async function checkPendingStkRequests(): Promise<{ checked: number; failed: number; rateLimited: boolean }> {
  const database = getDatabase();
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const pending = await database
    .select({ id: paymentRequests.id })
    .from(paymentRequests)
    .where(and(eq(paymentRequests.status, "pending"), lt(paymentRequests.createdAt, cutoff)))
    .orderBy(sql`${paymentRequests.lastCheckedAt} asc nulls first`, asc(paymentRequests.createdAt))
    .limit(STK_CHECKS_PER_RUN);

  let checked = 0;
  let failed = 0;
  let rateLimited = false;
  for (const [index, request] of pending.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, STK_CHECK_GAP_MS));
    try {
      await refreshStkStatus(request.id);
      checked += 1;
    } catch (error) {
      if (isDarajaRateLimit(error)) {
        rateLimited = true;
        console.warn(`[check-stk-status] Daraja rate limit after ${checked} checks; the remaining ${pending.length - index} wait for the next run`);
        break;
      }
      failed += 1;
      logError(`STK status check for ${request.id} failed`, error);
    }
  }

  // Tenant-initiated failures: wait 15 minutes so a retry can succeed before we SMS.
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
  const failedTenant = await database
    .select({
      id: paymentRequests.id,
      leaseId: paymentRequests.leaseId,
      amount: paymentRequests.amount,
      phone: paymentRequests.phone,
      resultCode: paymentRequests.resultCode,
      createdAt: paymentRequests.createdAt,
      unitCode: units.code,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(
      and(
        inArray(paymentRequests.status, ["cancelled", "timed_out", "failed"]),
        eq(paymentRequests.initiatedBy, "tenant"),
        lt(paymentRequests.createdAt, fifteenMinAgo),
        gte(paymentRequests.createdAt, dayAgo),
      ),
    )
    .orderBy(asc(paymentRequests.createdAt))
    .limit(100);

  for (const request of failedTenant) {
    const [paid] = await database
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.leaseId, request.leaseId),
          ne(payments.matchStatus, "reversed"),
          gte(payments.paidAt, request.createdAt),
        ),
      )
      .limit(1);
    if (paid) continue;
    await sendStkIncomplete({
      leaseId: request.leaseId,
      paymentRequestId: request.id,
      phone: request.phone,
      unitCode: request.unitCode,
      amount: request.amount,
      resultCode: request.resultCode,
    });
  }

  return { checked, failed, rateLimited };
}

/** Status of a payment request, plus the receipt token once paid. */
export async function getPaymentRequestStatus(requestId: string) {
  const [row] = await getDatabase()
    .select({
      id: paymentRequests.id,
      leaseId: paymentRequests.leaseId,
      tenantId: leases.tenantId,
      status: paymentRequests.status,
      resultDescription: paymentRequests.resultDescription,
      createdAt: paymentRequests.createdAt,
      lastCheckedAt: paymentRequests.lastCheckedAt,
      receiptToken: receipts.token,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .leftJoin(receipts, eq(receipts.paymentId, paymentRequests.paymentId))
    .where(eq(paymentRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

/** Leases a landlord can assign a payment to: current ones and those ended recently. */
export async function listAssignableLeases() {
  const cutoff = addDays(todayInNairobi(), -RECENTLY_ENDED_DAYS);
  return getDatabase()
    .select({ leaseId: leases.id, unitCode: units.code, tenantName: tenants.fullName, status: leases.status })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(or(inArray(leases.status, [...CURRENT_LEASE_STATUSES]), sql`${leases.endDate} >= ${cutoff}`))
    .orderBy(asc(units.code));
}

/** Everything the public receipt page shows, or null for an unknown token / short code. */
export async function getReceiptByToken(token: string) {
  const isShortCode = /^[A-Za-z0-9]{10}$/.test(token);
  const isLongToken = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  if (!isShortCode && !isLongToken) return null;
  const database = getDatabase();

  const [row] = await database
    .select({
      receiptNumber: receipts.number,
      token: receipts.token,
      shortCode: receipts.shortCode,
      voidedAt: receipts.voidedAt,
      paymentId: payments.id,
      amount: payments.amount,
      channel: payments.channel,
      mpesaReceipt: payments.mpesaReceipt,
      reference: sql<string | null>`${payments.raw}->>'reference'`,
      paidAt: payments.paidAt,
      paidByOther: payments.paidByOther,
      payerName: payments.payerName,
      payerPhone: payments.payerPhone,
      leaseId: leases.id,
      tenantName: tenants.fullName,
      unitCode: units.code,
      buildingName: buildings.name,
    })
    .from(receipts)
    .innerJoin(payments, eq(payments.id, receipts.paymentId))
    .innerJoin(leases, eq(leases.id, payments.leaseId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(isShortCode ? eq(receipts.shortCode, token) : eq(receipts.token, token))
    .limit(1);
  if (!row) return null;

  const [owner, covered, [after]] = await Promise.all([
    database.select({ name: landlord.name, phone: landlord.phone }).from(landlord).orderBy(asc(landlord.createdAt)).limit(1),
    // Net per line: negative rows (reversals, deposit moves) cancel earlier ones.
    database
      .select({
        description: invoiceLines.description,
        type: invoiceLines.type,
        invoiceNumber: invoices.number,
        period: invoices.period,
        dueDate: invoices.dueDate,
        lineAmount: sql<number>`(${invoiceLines.amount} - ${invoiceLines.waivedAmount})::int`,
        amount: sql<number>`sum(${allocations.amount})::int`,
      })
      .from(allocations)
      .innerJoin(invoiceLines, eq(invoiceLines.id, allocations.invoiceLineId))
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(eq(allocations.paymentId, row.paymentId))
      .groupBy(
        invoiceLines.id,
        invoiceLines.description,
        invoiceLines.type,
        invoiceLines.amount,
        invoiceLines.waivedAmount,
        invoices.number,
        invoices.period,
        invoices.dueDate,
      )
      .having(sql`sum(${allocations.amount}) > 0`)
      .orderBy(asc(invoices.period), asc(sql`min(${allocations.createdAt})`)),
    // Balance after this payment: every ledger entry for the lease up to and including its credit.
    // Compared in SQL because JavaScript dates drop Postgres's microseconds.
    database
      .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::int` })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.leaseId, row.leaseId),
          sql`${ledgerEntries.createdAt} <= (select le.created_at from ledger_entries le where le.payment_id = ${row.paymentId} and le.type = 'payment' order by le.created_at limit 1)`,
        ),
      ),
  ]);

  let primaryPeriod = covered[0]?.period ?? null;
  let dueDate = covered.find((line) => line.dueDate)?.dueDate ?? null;
  let billTotal = 0;
  let paidSoFar = 0;
  const balanceAfter = after?.balance ?? 0;

  if (!primaryPeriod) {
    const [latest] = await database
      .select({ period: invoices.period, dueDate: invoices.dueDate })
      .from(invoices)
      .where(eq(invoices.leaseId, row.leaseId))
      .orderBy(sql`${invoices.period} desc`)
      .limit(1);
    primaryPeriod = latest?.period ?? null;
    dueDate = dueDate ?? latest?.dueDate ?? null;
  }

  if (primaryPeriod) {
    const [bill] = await database
      .select({
        billTotal: sql<number>`coalesce(sum(${invoiceLines.amount} - ${invoiceLines.waivedAmount}), 0)::int`,
        paidSoFar: sql<number>`coalesce((
          select sum(a.amount)::int from allocations a
          inner join invoice_lines il on il.id = a.invoice_line_id
          inner join invoices inv on inv.id = il.invoice_id
          where inv.lease_id = ${row.leaseId} and inv.period = ${primaryPeriod}
            and a.created_at <= (
              select le.created_at from ledger_entries le
              where le.payment_id = ${row.paymentId} and le.type = 'payment'
              order by le.created_at limit 1
            )
        ), 0)`,
      })
      .from(invoices)
      .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
      .where(and(eq(invoices.leaseId, row.leaseId), eq(invoices.period, primaryPeriod)));
    billTotal = bill?.billTotal ?? 0;
    paidSoFar = Math.min(billTotal, Math.max(0, bill?.paidSoFar ?? 0));
    if (billTotal === 0 && paidSoFar === 0) {
      paidSoFar = balanceAfter <= 0 ? billTotal : Math.max(0, billTotal - balanceAfter);
    }
  }

  return {
    ...row,
    landlordName: owner[0]?.name ?? "",
    landlordPhone: owner[0]?.phone ?? null,
    covered,
    balanceAfter,
    billTotal,
    paidSoFar,
    primaryPeriod,
    dueDate,
  };
}

// ---------------------------------------------------------------------------
// Manual payments, claims, reversals, reconciliation (step 4)
// ---------------------------------------------------------------------------

/** Noon Nairobi time on a date, so the payment always lands on that business date. */
function middayOn(date: IsoDate): Date {
  return new Date(startOfNairobiDay(date).getTime() + 12 * 60 * 60 * 1000);
}

async function leaseForPayment(leaseId: string) {
  const [lease] = await getDatabase()
    .select({ id: leases.id, status: leases.status, unitCode: units.code, tenantId: tenants.id, tenantName: tenants.fullName, phone: tenants.phone })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(eq(leases.id, leaseId));
  if (!lease) throw new ServiceError("Lease not found");
  return lease;
}

/** A bank or cash payment entered by the landlord: same posting as M-Pesa (allocations, ledger, receipt, SMS). */
export async function recordManualPayment(input: {
  leaseId: string;
  amount: number;
  paidOn: IsoDate;
  method: "bank" | "cash";
  reference?: string | null;
  actor: string;
  today?: IsoDate;
}): Promise<RecordPaymentResult> {
  const paidOn = assertIsoDate(input.paidOn);
  const today = input.today ?? todayInNairobi();
  if (paidOn > today) throw new ServiceError("The payment date can't be in the future");
  await assertDateOpen(paidOn, "The payment date");
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) throw new ServiceError("Amount must be a whole number of at least 1");
  const reference = input.reference?.trim() || null;
  const lease = await leaseForPayment(input.leaseId);

  if (reference) {
    const [duplicate] = await getDatabase()
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.channel, input.method), ne(payments.matchStatus, "reversed"), sql`${payments.raw}->>'reference' = ${reference}`))
      .limit(1);
    if (duplicate) throw new ServiceError(`A ${input.method} payment with reference ${reference} is already recorded`);
  }

  const result = await recordPayment({
    channel: input.method,
    mpesaReceipt: null,
    amount: input.amount,
    accountReference: lease.unitCode,
    payerName: lease.tenantName,
    payerPhone: null,
    paidAt: middayOn(paidOn),
    leaseId: lease.id,
    raw: { method: input.method, reference, recordedBy: input.actor },
    reference: reference ? `${input.method.toUpperCase()} ${reference}` : null,
  });
  await writeAudit(getDatabase(), {
    actor: input.actor,
    action: "payment.record_manual",
    entity: "payment",
    entityId: result.paymentId,
    after: { leaseId: lease.id, amount: input.amount, paidOn, method: input.method, reference },
  });
  return result;
}

export const CLAIM_METHODS = ["bank", "cash", "mpesa"] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

/** A tenant reports a payment the system hasn't seen (e.g. a bank deposit). Optional slip photo, max 5 MB. */
export async function submitPaymentClaim(input: {
  leaseId: string;
  amount: number;
  paidOn: IsoDate;
  method: ClaimMethod;
  reference?: string | null;
  slipFile?: { bytes: Uint8Array } | null;
  actor?: string;
  today?: IsoDate;
}) {
  const paidOn = assertIsoDate(input.paidOn);
  const today = input.today ?? todayInNairobi();
  if (paidOn > today) throw new ServiceError("The payment date can't be in the future");
  await assertDateOpen(paidOn, "The payment date");
  if (!Number.isSafeInteger(input.amount) || input.amount < 1) throw new ServiceError("Amount must be a whole number of at least 1");
  if (!(CLAIM_METHODS as readonly string[]).includes(input.method)) throw new ServiceError("Method must be bank, cash or mpesa");
  const reference = input.reference?.trim() || null;
  if (input.method === "mpesa" && !reference) throw new ServiceError("Enter the M-Pesa receipt number");
  const lease = await leaseForPayment(input.leaseId);
  if (lease.status === "ended") throw new ServiceError("This lease has ended");

  let slipKey: string | null = null;
  if (input.slipFile) {
    let inspected: { contentType: string; extension: string };
    try {
      inspected = inspectSlip(input.slipFile.bytes);
    } catch (error) {
      throw new ServiceError(error instanceof Error ? error.message : "Invalid slip");
    }
    slipKey = `slips/${lease.id}/${randomUUID()}.${inspected.extension}`;
    await getStorage().put(slipKey, input.slipFile.bytes, inspected.contentType);
  }

  const [claim] = await getDatabase()
    .insert(paymentClaims)
    .values({ leaseId: lease.id, amount: input.amount, paidOn, method: input.method, reference, slipKey, status: "waiting" })
    .returning();
  if (!claim) throw new Error("Claim insert returned no row");
  await writeAudit(getDatabase(), {
    actor: input.actor ?? `tenant:${lease.tenantId}`,
    action: "payment_claim.submit",
    entity: "payment_claim",
    entityId: claim.id,
    after: claim,
  });
  await notifyLandlordClaim(claim.id, {
    amount: claim.amount,
    unitCode: lease.unitCode,
    tenantName: lease.tenantName,
    method: claim.method,
    reference,
  });
  await notifyTenantClaimReceived(claim.id);
  return claim;
}

/** A short-lived link to a claim's slip photo. */
export async function getClaimSlipUrl(claimId: string): Promise<string | null> {
  const [claim] = await getDatabase().select({ slipKey: paymentClaims.slipKey }).from(paymentClaims).where(eq(paymentClaims.id, claimId));
  if (!claim) throw new ServiceError("Claim not found");
  return claim.slipKey ? getStorage().getSignedUrl(claim.slipKey) : null;
}

/** Confirms a claim: records the payment (receipt SMS goes to the tenant), then marks the claim confirmed. */
export async function confirmPaymentClaim(input: { claimId: string; actor: string; today?: IsoDate }) {
  const database = getDatabase();
  // Claim it first so two confirmations can't both record a payment.
  const [claim] = await database
    .update(paymentClaims)
    .set({ status: "confirmed", decidedAt: new Date() })
    .where(and(eq(paymentClaims.id, input.claimId), eq(paymentClaims.status, "waiting")))
    .returning();
  if (!claim) throw new ServiceError("This claim is not waiting for a decision");

  let result: RecordPaymentResult;
  try {
    if (claim.method === "mpesa") {
      const lease = await leaseForPayment(claim.leaseId);
      result = await recordPayment({
        channel: "paybill",
        mpesaReceipt: (claim.reference ?? "").toUpperCase(),
        amount: claim.amount,
        accountReference: lease.unitCode,
        payerName: lease.tenantName,
        payerPhone: null,
        paidAt: middayOn(claim.paidOn),
        leaseId: claim.leaseId,
        raw: { claimId: claim.id, confirmedBy: input.actor },
      });
    } else {
      result = await recordManualPayment({
        leaseId: claim.leaseId,
        amount: claim.amount,
        paidOn: claim.paidOn,
        method: claim.method === "cash" ? "cash" : "bank",
        reference: claim.reference,
        actor: input.actor,
        today: input.today,
      });
    }
  } catch (error) {
    await database.update(paymentClaims).set({ status: "waiting", decidedAt: null }).where(eq(paymentClaims.id, claim.id));
    throw error;
  }

  const [after] = await database.update(paymentClaims).set({ paymentId: result.paymentId }).where(eq(paymentClaims.id, claim.id)).returning();
  await writeAudit(database, {
    actor: input.actor,
    action: "payment_claim.confirm",
    entity: "payment_claim",
    entityId: claim.id,
    before: { status: "waiting" },
    after: { status: "confirmed", paymentId: result.paymentId, duplicate: result.duplicate },
  });
  refreshLandlordScreens();
  return { claim: after, payment: result };
}

export async function rejectPaymentClaim(input: { claimId: string; reason: string; actor: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new ServiceError("A reason is required");
  const database = getDatabase();
  const [claim] = await database
    .update(paymentClaims)
    .set({ status: "rejected", reason, decidedAt: new Date() })
    .where(and(eq(paymentClaims.id, input.claimId), eq(paymentClaims.status, "waiting")))
    .returning();
  if (!claim) throw new ServiceError("This claim is not waiting for a decision");
  await writeAudit(database, {
    actor: input.actor,
    action: "payment_claim.reject",
    entity: "payment_claim",
    entityId: claim.id,
    before: { status: "waiting" },
    after: { status: "rejected" },
    reason,
  });
  const lease = await leaseForPayment(claim.leaseId);
  await notifyClaimRejected({ leaseId: claim.leaseId, claimId: claim.id, phone: lease.phone, amount: claim.amount, reason });
  return claim;
}

/**
 * Reverses a payment: marks it reversed, posts a ledger debit (type "reversal"), undoes its allocations with
 * negative rows, voids the receipt and texts the tenant. Other credit on the lease is then re-applied.
 */
export async function reversePayment(input: { paymentId: string; reason: string; actor: string; today?: IsoDate }) {
  const reason = input.reason.trim();
  if (!reason) throw new ServiceError("A reason is required");
  const today = input.today ?? todayInNairobi();

  const result = await getDatabase().transaction(async (transaction) => {
    const [payment] = await transaction.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
    if (!payment) throw new ServiceError("Payment not found");
    if (payment.matchStatus === "reversed") throw new ServiceError("This payment is already reversed");
    if (payment.matchStatus === "imported") throw new ServiceError("Imported history payments can't be reversed: they are not part of the balance");
    if (payment.leaseId) await transaction.select({ id: leases.id }).from(leases).where(eq(leases.id, payment.leaseId)).for("update");

    await transaction.update(payments).set({ matchStatus: "reversed" }).where(eq(payments.id, payment.id));

    let undone = 0;
    if (payment.leaseId && payment.matchStatus === "matched") {
      const [entry] = await transaction
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.paymentId, payment.id), eq(ledgerEntries.type, "payment")))
        .limit(1);
      if (entry) {
        await transaction.insert(ledgerEntries).values({
          leaseId: entry.leaseId,
          entryDate: today,
          type: "reversal",
          account: entry.account,
          reference: `Reversal of ${payment.mpesaReceipt ?? entry.reference}: ${reason}`.slice(0, 200),
          debit: entry.credit,
          credit: entry.debit,
          paymentId: payment.id,
          reversesEntryId: entry.id,
        });
      }
      const perLine = await transaction
        .select({ invoiceLineId: allocations.invoiceLineId, net: sql<number>`sum(${allocations.amount})::int` })
        .from(allocations)
        .where(eq(allocations.paymentId, payment.id))
        .groupBy(allocations.invoiceLineId);
      const mirrors = perLine.filter((row) => row.net > 0).map((row) => ({ paymentId: payment.id, invoiceLineId: row.invoiceLineId, amount: -row.net }));
      if (mirrors.length) await transaction.insert(allocations).values(mirrors);
      undone = mirrors.reduce((sum, row) => sum - row.amount, 0);
      await transaction.update(receipts).set({ voidedAt: new Date() }).where(eq(receipts.paymentId, payment.id));
      await applyCredit(payment.leaseId, transaction, today);
    }

    await writeAudit(transaction, {
      actor: input.actor,
      action: "payment.reverse",
      entity: "payment",
      entityId: payment.id,
      before: { matchStatus: payment.matchStatus },
      after: { matchStatus: "reversed", allocationsUndone: undone },
      reason,
    });
    return { paymentId: payment.id, leaseId: payment.leaseId, amount: payment.amount, allocationsUndone: undone, wasMatched: payment.matchStatus === "matched" };
  });

  if (result.wasMatched) await notifyPaymentReversed(result.paymentId, reason);
  refreshLandlordScreens();
  return result;
}

// ---- M-Pesa statement reconciliation ----

/** Minimal CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "2026-11-03 10:00:00", "03-11-2026 10:00:00" or "03/11/2026 10:00" in Nairobi time. */
function parseStatementTime(value: string): Date | null {
  const text = value.trim();
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  let parts: number[] | null = match ? [match[1], match[2], match[3], match[4], match[5], match[6] ?? "0"].map(Number) : null;
  if (!parts) {
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
    parts = match ? [match[3], match[2], match[1], match[4], match[5], match[6] ?? "0"].map(Number) : null;
  }
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - 3 * 60 * 60 * 1000);
}

/**
 * Imports Paybill receipts missing from the database, from an M-Pesa business portal statement CSV.
 * Finds the header row containing "Receipt No" and maps columns by name.
 */
export async function reconcileStatement(input: { csvText: string; actor: string }) {
  const rows = parseCsv(input.csvText.replace(/^﻿/, ""));
  const headerIndex = rows.findIndex((row) => row.some((cell) => /receipt\s*no/i.test(cell)));
  if (headerIndex === -1) throw new ServiceError('No header row with "Receipt No" found');
  const header = rows[headerIndex]?.map((cell) => cell.trim()) ?? [];
  const column = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));
  const columns = {
    receipt: column(/receipt\s*no/i),
    completed: column(/completion\s*time/i),
    paidIn: column(/paid\s*in/i),
    account: column(/^(a\/c\s*no\.?|account\s*(no\.?|number)?)$/i),
    otherParty: column(/other\s*party/i),
    status: column(/transaction\s*status/i),
    details: column(/^details$/i),
  };
  if (columns.receipt < 0 || columns.completed < 0 || columns.paidIn < 0) {
    throw new ServiceError("The statement needs Receipt No., Completion Time and Paid In columns");
  }

  type Candidate = { line: number; receipt: string; amount: number; paidAt: Date; account: string; payerName: string | null; payerPhone: string | null };
  const candidates: Candidate[] = [];
  const unreadableRows: { line: number; reason: string }[] = [];
  let rowsRead = 0;
  let notPaidIn = 0;

  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const line = headerIndex + offset + 2;
    if (row.every((cell) => cell.trim() === "")) return;
    rowsRead += 1;
    const cell = (index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
    const paidInText = cell(columns.paidIn);
    if (!paidInText || /^0+(\.0+)?$/.test(paidInText.replace(/,/g, ""))) {
      notPaidIn += 1;
      return;
    }
    if (columns.status >= 0 && cell(columns.status) && !/completed/i.test(cell(columns.status))) {
      notPaidIn += 1;
      return;
    }
    const receipt = cell(columns.receipt).toUpperCase();
    if (!/^[A-Z0-9]{8,12}$/.test(receipt)) return void unreadableRows.push({ line, reason: `bad receipt number "${receipt}"` });
    let amount: number;
    try {
      amount = parseShillings(paidInText);
    } catch {
      return void unreadableRows.push({ line, reason: `bad amount "${paidInText}"` });
    }
    const paidAt = parseStatementTime(cell(columns.completed));
    if (!paidAt) return void unreadableRows.push({ line, reason: `bad completion time "${cell(columns.completed)}"` });
    const account =
      cell(columns.account) || /(?:acc(?:ount)?\.?\s*(?:no\.?|number)?\s*[:.]?\s*)([A-Za-z0-9 -]{2,20})/i.exec(cell(columns.details))?.[1]?.trim() || "";
    const [payerPhone, ...nameParts] = cell(columns.otherParty).split(" - ");
    candidates.push({
      line,
      receipt,
      amount,
      paidAt,
      account,
      payerPhone: payerPhone?.trim() || null,
      payerName: nameParts.join(" - ").trim() || null,
    });
  });

  const known = candidates.length
    ? await getDatabase()
        .select({ receipt: payments.mpesaReceipt })
        .from(payments)
        .where(inArray(payments.mpesaReceipt, candidates.map((candidate) => candidate.receipt)))
    : [];
  const knownSet = new Set(known.map((row) => row.receipt));

  let alreadyRecorded = 0;
  let imported = 0;
  let unmatched = 0;
  for (const candidate of candidates) {
    if (knownSet.has(candidate.receipt)) {
      alreadyRecorded += 1;
      continue;
    }
    const match = await matchByAccount(candidate.account, toNairobiDate(candidate.paidAt));
    const result = await recordPayment({
      channel: "paybill",
      mpesaReceipt: candidate.receipt,
      amount: candidate.amount,
      accountReference: candidate.account || null,
      payerName: candidate.payerName,
      payerPhone: candidate.payerPhone,
      paidAt: candidate.paidAt,
      leaseId: match.leaseId,
      raw: { source: "statement", line: candidate.line, importedBy: input.actor },
    });
    knownSet.add(candidate.receipt);
    if (result.duplicate) alreadyRecorded += 1;
    else {
      imported += 1;
      if (!result.matched) unmatched += 1;
    }
  }

  const summary = { rowsRead, notPaidIn, alreadyRecorded, imported, unmatched, unreadableRows };
  await writeAudit(getDatabase(), { actor: input.actor, action: "payments.reconcile", entity: "payments", after: summary });
  return summary;
}

// ---------------------------------------------------------------------------
// Reads for the landlord screens
// ---------------------------------------------------------------------------

export type PaymentListFilter = {
  status?: "all" | "unmatched" | "reversed";
  from?: IsoDate;
  to?: IsoDate;
  buildingId?: string | null;
  channel?: PaymentChannel | null;
  leaseId?: string | null;
  limit?: number;
};

function paymentConditions(filter: PaymentListFilter) {
  return [
    filter.status === "unmatched" ? eq(payments.matchStatus, "unmatched") : undefined,
    filter.status === "reversed" ? eq(payments.matchStatus, "reversed") : undefined,
    filter.from ? sql`${payments.paidAt} >= ${startOfNairobiDay(assertIsoDate(filter.from)).toISOString()}::timestamptz` : undefined,
    filter.to ? sql`${payments.paidAt} < ${startOfNairobiDay(addDays(assertIsoDate(filter.to), 1)).toISOString()}::timestamptz` : undefined,
    filter.buildingId ? eq(units.buildingId, filter.buildingId) : undefined,
    filter.channel ? eq(payments.channel, filter.channel) : undefined,
    filter.leaseId ? eq(payments.leaseId, filter.leaseId) : undefined,
  ];
}

const paymentListColumns = {
  id: payments.id,
  paidAt: payments.paidAt,
  channel: payments.channel,
  amount: payments.amount,
  mpesaReceipt: payments.mpesaReceipt,
  accountReference: payments.accountReference,
  payerName: payments.payerName,
  payerPhone: payments.payerPhone,
  paidByOther: payments.paidByOther,
  matchStatus: payments.matchStatus,
  leaseId: payments.leaseId,
  unitCode: units.code,
  tenantName: tenants.fullName,
  tenantId: tenants.id,
  receiptNumber: receipts.number,
  receiptToken: receipts.token,
  receiptVoided: sql<boolean>`${receipts.voidedAt} is not null`,
};

export async function listPayments(filter: PaymentListFilter = {}) {
  return getDatabase()
    .select(paymentListColumns)
    .from(payments)
    .leftJoin(leases, eq(leases.id, payments.leaseId))
    .leftJoin(units, eq(units.id, leases.unitId))
    .leftJoin(tenants, eq(tenants.id, leases.tenantId))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(and(...paymentConditions(filter)))
    .orderBy(sql`${payments.paidAt} desc`)
    .limit(filter.limit ?? 200);
}

/** Payments matching the filter (for tab badges). */
export async function countPayments(filter: Omit<PaymentListFilter, "limit"> = {}): Promise<number> {
  const query = getDatabase().select({ count: sql<number>`count(*)::int` }).from(payments);
  const needsUnits = Boolean(filter.buildingId);
  const [row] = await (needsUnits
    ? query.leftJoin(leases, eq(leases.id, payments.leaseId)).leftJoin(units, eq(units.id, leases.unitId))
    : query
  ).where(and(...paymentConditions(filter)));
  return row?.count ?? 0;
}

/** Keyset sort for payment lists: newest paid first, id breaks ties (payments grow fastest). */
const PAYMENT_KEYS: KeysetKey[] = [
  { expression: sql`${payments.paidAt}`, cast: "timestamptz" },
  { expression: sql`${payments.id}`, cast: "uuid" },
];

/** One page (25) of payments, newest first, with cursors for Previous/Next. */
export async function pagePayments(filter: Omit<PaymentListFilter, "limit">, request: PageRequest) {
  return fetchKeysetPage({
    keys: PAYMENT_KEYS,
    order: "desc",
    request,
    count: () => countPayments(filter),
    fetch: (plan) =>
      getDatabase()
        .select({ ...paymentListColumns, cursorAt: sql<string>`${payments.paidAt}::text` })
        .from(payments)
        .leftJoin(leases, eq(leases.id, payments.leaseId))
        .leftJoin(units, eq(units.id, leases.unitId))
        .leftJoin(tenants, eq(tenants.id, leases.tenantId))
        .leftJoin(receipts, eq(receipts.paymentId, payments.id))
        .where(and(...paymentConditions(filter), plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit)
        .offset(plan.offset),
    cursorOf: (row) => [row.cursorAt, row.id],
  });
}

type ClaimFilter = { status?: "waiting" | "confirmed" | "rejected" | "all"; leaseId?: string };

function claimConditions(filter: ClaimFilter) {
  return and(
    filter.status && filter.status !== "all" ? eq(paymentClaims.status, filter.status) : undefined,
    filter.leaseId ? eq(paymentClaims.leaseId, filter.leaseId) : undefined,
  );
}

/** One page (25) of payment claims, newest first. */
export async function pagePaymentClaims(filter: ClaimFilter, request: PageRequest) {
  return fetchOffsetPage({
    request,
    count: async () => (await getDatabase().select({ count: sql<number>`count(*)::int` }).from(paymentClaims).where(claimConditions(filter)))[0]?.count ?? 0,
    fetch: (limit, offset) => claimQuery(filter, true).limit(limit).offset(offset),
    totalOf: (row) => row.total ?? 0,
  });
}

export async function listPaymentClaims(filter: ClaimFilter = {}) {
  return claimQuery(filter).limit(200);
}

function claimQuery(filter: ClaimFilter, withTotal = false) {
  return getDatabase()
    .select({
      ...(withTotal ? { total: windowTotal } : {}),
      id: paymentClaims.id,
      leaseId: paymentClaims.leaseId,
      amount: paymentClaims.amount,
      paidOn: paymentClaims.paidOn,
      method: paymentClaims.method,
      reference: paymentClaims.reference,
      hasSlip: sql<boolean>`${paymentClaims.slipKey} is not null`,
      status: paymentClaims.status,
      reason: paymentClaims.reason,
      createdAt: paymentClaims.createdAt,
      unitCode: units.code,
      tenantName: tenants.fullName,
    })
    .from(paymentClaims)
    .innerJoin(leases, eq(leases.id, paymentClaims.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(claimConditions(filter))
    .orderBy(sql`${paymentClaims.createdAt} desc`, desc(paymentClaims.id))
    .$dynamic();
}

type RequestFilter = { leaseId?: string; status?: PaymentRequestStatus };

function requestConditions(filter: RequestFilter) {
  return and(
    filter.leaseId ? eq(paymentRequests.leaseId, filter.leaseId) : undefined,
    filter.status ? eq(paymentRequests.status, filter.status) : undefined,
  );
}

/** One page (25) of M-Pesa (STK) requests, newest first. */
export async function pagePaymentRequests(filter: RequestFilter, request: PageRequest) {
  return fetchOffsetPage({
    request,
    count: async () => (await getDatabase().select({ count: sql<number>`count(*)::int` }).from(paymentRequests).where(requestConditions(filter)))[0]?.count ?? 0,
    fetch: (limit, offset) => requestQuery(filter, true).limit(limit).offset(offset),
    totalOf: (row) => row.total ?? 0,
  });
}

export async function listPaymentRequests(filter: RequestFilter = {}) {
  return requestQuery(filter).limit(200);
}

function requestQuery(filter: RequestFilter, withTotal = false) {
  return getDatabase()
    .select({
      ...(withTotal ? { total: windowTotal } : {}),
      id: paymentRequests.id,
      amount: paymentRequests.amount,
      phone: paymentRequests.phone,
      status: paymentRequests.status,
      resultDescription: paymentRequests.resultDescription,
      createdAt: paymentRequests.createdAt,
      unitCode: units.code,
      tenantName: tenants.fullName,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(requestConditions(filter))
    .orderBy(sql`${paymentRequests.createdAt} desc`, desc(paymentRequests.id))
    .$dynamic();
}
