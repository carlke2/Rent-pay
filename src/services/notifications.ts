import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getSmsSender, type SmsResult } from "@/adapters/sms";
import { createBillLink, createPayLink } from "@/authentication/pay-links";
import { getEnvironment } from "@/configuration/environment";
import { graceEndsOn } from "@/core/billing";
import { getDatabase } from "@/database/client";
import {
  invoiceLines,
  invoices,
  landlord,
  ledgerEntries,
  leases,
  messages,
  paymentClaims,
  payments,
  receipts,
  tenants,
  units,
} from "@/database/schema";
import {
  addDays,
  addMonthsToPeriod,
  daysBetween,
  formatDate,
  nairobiParts,
  startOfNairobiDay,
  todayInNairobi,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";
import { formatAmount, formatShillings, sumShillings } from "@/utilities/money";
import { fitSms, smsLink, smsPrefix, toGsm7 } from "@/utilities/sms-text";
import { countReadingsToConfirm } from "./billing";
import { loadPolicyResolver } from "./policies";
import { leaseBalance } from "./tenancy";
import { logError } from "@/utilities/log";
import { maskPhone } from "@/utilities/phone";

export type SendOutcome = "sent" | "failed" | "skipped";

type SendInput = {
  to: string;
  body: string;
  template: string;
  leaseId?: string | null;
  relatedId?: string | null;
  /** What to store instead of the body when it contains a secret (e.g. a login code). */
  storedBody?: string;
  /** Receipts and login codes go out at any hour; everything else respects quiet hours. */
  ignoreQuietHours?: boolean;
};

const DELIVERED_STATUSES = ["sent", "delivered", "queued"] as const;

/** No messages between 21:00 and 07:00 Nairobi time (real clock), except receipts and login codes. */
export function isQuietHours(instant: Date = new Date()): boolean {
  const { hour } = nairobiParts(instant);
  return hour >= 21 || hour < 7;
}

/** "5 Dec" — same as formatDate but without the year. */
export function formatSmsDate(date: IsoDate): string {
  return formatDate(date).replace(/\s+\d{4}$/, "");
}

function periodMonthName(period: BillingPeriod, style: "short" | "long"): string {
  return new Intl.DateTimeFormat("en-KE", { month: style, timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function prepareSmsBody(text: string): string {
  const appName = getEnvironment().APP_NAME;
  const prefix = smsPrefix(appName);
  const withPrefix = text.startsWith(prefix) ? text : `${prefix}${text}`;
  const body = toGsm7(withPrefix);
  return body.length > 160 ? body.slice(0, 160) : body;
}

/**
 * Optional parts drop order when over 160: paybill, then Thank you, then breakdown.
 * `required` may include `<<<BD>>>` (breakdown) and `<<<TY>>>` (thank you) markers.
 */
function fitPayingSms(input: {
  required: string;
  breakdown?: string;
  thankYou?: string;
  paybill?: string;
}): string {
  let breakdown = input.breakdown ?? "";
  let thankYou = input.thankYou ?? "";
  let paybill = input.paybill ?? "";

  const build = () =>
    toGsm7(
      (
        input.required.replace("<<<BD>>>", breakdown).replace("<<<TY>>>", thankYou) + paybill
      )
        .replace(/ {2,}/g, " ")
        .replace(/ \./g, "."),
    );

  let body = build();
  if (body.length <= 160) return body;
  paybill = "";
  body = build();
  if (body.length <= 160) return body;
  thankYou = "";
  body = build();
  if (body.length <= 160) return body;
  breakdown = "";
  body = build();
  return body.length > 160 ? body.slice(0, 160) : body;
}

async function alreadySent(
  template: string,
  leaseId: string | null | undefined,
  relatedId: string | null | undefined,
): Promise<boolean> {
  if (!leaseId || !relatedId) return false;
  const [row] = await getDatabase()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.leaseId, leaseId),
        eq(messages.template, template),
        eq(messages.relatedId, relatedId),
        inArray(messages.status, DELIVERED_STATUSES),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Sends one SMS and records it in `messages`. Never throws: a failed send is recorded as failed,
 * so billing and payment processing can't be broken by notifications. During quiet hours the
 * message is skipped (not sent, not recorded) and reported as "skipped".
 */
export async function sendSms(input: SendInput): Promise<{ status: SendOutcome }> {
  if (!input.ignoreQuietHours && isQuietHours()) {
    console.info(`[notifications] quiet hours: skipped ${input.template} to ${maskPhone(input.to)}`);
    return { status: "skipped" };
  }

  const body = prepareSmsBody(input.body);
  const storedBody = input.storedBody ? prepareSmsBody(input.storedBody) : body;

  let result: SmsResult;
  try {
    result = await getSmsSender().send(input.to, body);
  } catch (error) {
    logError(`[notifications] ${input.template} to ${maskPhone(input.to)} failed`, error);
    result = { providerId: null, status: "failed", cost: null };
  }

  try {
    await getDatabase()
      .insert(messages)
      .values({
        recipient: input.to,
        channel: "sms",
        template: input.template,
        body: storedBody,
        status: result.status,
        providerId: result.providerId,
        cost: result.cost,
        leaseId: input.leaseId ?? null,
        relatedId: input.relatedId ?? null,
      });
  } catch (error) {
    logError(`[notifications] could not record ${input.template} message`, error);
  }
  return { status: result.status };
}

function paybillPart(unitCode: string): string {
  return ` or Paybill ${getEnvironment().MPESA_SHORTCODE} Acc ${unitCode}`;
}

/** host/bill/{code}, or the Paybill details if a link can't be made. */
async function billLinkOr(leaseId: string, unitCode: string): Promise<string> {
  try {
    return await createBillLink(leaseId);
  } catch (error) {
    logError("[notifications] could not create a bill link", error);
    return `Paybill ${getEnvironment().MPESA_SHORTCODE} Acc ${unitCode}`;
  }
}

/** "tomorrow" or "on 5 Dec". */
function dueWhen(due: IsoDate, today: IsoDate): string {
  return due === addDays(today, 1) ? "tomorrow" : `on ${formatSmsDate(due)}`;
}

/** The SMS wording for bills, reminders and late fees (details live on the /bill card). */
export const billSms = {
  bill: (input: { mon: string; unit: string; balance: number; due: IsoDate; link: string }) =>
    `${input.mon} bill for ${input.unit} is ${formatShillings(input.balance)}. Due ${formatSmsDate(input.due)}. View and pay: ${input.link}`,
  reminder: (input: { unit: string; balance: number; due: IsoDate; today: IsoDate; link: string }) =>
    `Reminder, ${formatShillings(input.balance)} for ${input.unit} is due ${dueWhen(input.due, input.today)}. View and pay: ${input.link}`,
  overdue: (input: { unit: string; balance: number; days: number; link: string }) =>
    `${formatShillings(input.balance)} for ${input.unit} is ${input.days} days overdue. Please pay today: ${input.link}`,
  lateFee: (input: { unit: string; fee: number; balance: number; link: string }) =>
    `A late fee of ${formatShillings(input.fee)} was added to ${input.unit}. Balance ${formatShillings(input.balance)}. ${input.link}`,
};

/** "Balance KES 2,000" or "Credit KES 500". */
export function describeBalance(balance: number): string {
  return balance < 0 ? `Credit ${formatShillings(-balance)}` : `Balance ${formatShillings(balance)}`;
}

async function landlordPhone(): Promise<string | null> {
  const [owner] = await getDatabase().select({ phone: landlord.phone }).from(landlord).orderBy(asc(landlord.createdAt)).limit(1);
  return owner?.phone ?? null;
}

function stkIncompleteReason(resultCode: string | null | undefined): string {
  switch (String(resultCode ?? "")) {
    case "1032":
      return "cancelled";
    case "1037":
      return "timed out";
    case "1":
      return "not enough balance";
    case "2001":
      return "wrong PIN";
    default:
      return "failed";
  }
}

function channelPhrase(row: {
  channel: string;
  mpesaReceipt: string | null;
  raw: unknown;
}): string | null {
  if (row.channel === "stk" || row.channel === "paybill") {
    return row.mpesaReceipt ? `M-Pesa ${row.mpesaReceipt}` : null;
  }
  if (row.channel === "bank") {
    const reference =
      row.raw && typeof row.raw === "object" && "reference" in row.raw
        ? String((row.raw as { reference?: unknown }).reference ?? "").trim()
        : "";
    return reference ? `bank ref ${reference}` : "bank";
  }
  if (row.channel === "cash") return "cash";
  return null;
}

async function earliestOpenDueDate(leaseId: string): Promise<IsoDate | null> {
  const rows = await getDatabase()
    .select({
      dueDate: invoices.dueDate,
      open: sql<number>`sum("invoice_lines"."amount" - "invoice_lines"."waived_amount" - (select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = "invoice_lines"."id"))::int`,
    })
    .from(invoices)
    .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
    .where(eq(invoices.leaseId, leaseId))
    .groupBy(invoices.id)
    .orderBy(asc(invoices.dueDate), asc(invoices.period));
  return rows.find((row) => row.open > 0)?.dueDate ?? null;
}

async function latestInvoicePeriod(leaseId: string): Promise<BillingPeriod | null> {
  const [row] = await getDatabase()
    .select({ period: invoices.period })
    .from(invoices)
    .where(eq(invoices.leaseId, leaseId))
    .orderBy(desc(invoices.period))
    .limit(1);
  return row?.period ?? null;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** Texts the tenant their receipt, at any hour. Never throws. */
export async function sendReceipt(paymentId: string): Promise<void> {
  try {
    const template = "payment_receipt";
    const [row] = await getDatabase()
      .select({
        amount: payments.amount,
        channel: payments.channel,
        mpesaReceipt: payments.mpesaReceipt,
        raw: payments.raw,
        leaseId: payments.leaseId,
        paidByOther: payments.paidByOther,
        payerName: payments.payerName,
        phone: tenants.phone,
        unitCode: units.code,
        receiptId: receipts.id,
        receiptNumber: receipts.number,
        token: receipts.token,
        shortCode: receipts.shortCode,
      })
      .from(payments)
      .innerJoin(receipts, eq(receipts.paymentId, payments.id))
      .innerJoin(leases, eq(leases.id, payments.leaseId))
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(payments.id, paymentId))
      .limit(1);
    if (!row || !row.leaseId) {
      console.warn(`[notifications] no receipt to send for payment ${paymentId}`);
      return;
    }
    if (await alreadySent(template, row.leaseId, paymentId)) return;

    const balance = await leaseBalance(row.leaseId);
    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const receiptPath = `/receipts/${row.shortCode || row.token}`;
    const receiptLink = smsLink(getEnvironment().APP_URL, receiptPath);
    const paidByName = row.paidByOther && row.payerName ? `paid by ${firstName(row.payerName)}` : null;
    const channel = channelPhrase(row);
    const period = (await latestInvoicePeriod(row.leaseId)) ?? todayInNairobi().slice(0, 7);
    const month = periodMonthName(period, "long");
    const nextMonth = periodMonthName(addMonthsToPeriod(period, 1), "long");

    /** ", paid by Jane, M-Pesa REF. " or ", cash. " or ". " */
    const afterUnit = (includeChannel: boolean) => {
      const bits = [paidByName, includeChannel ? channel : null].filter(Boolean) as string[];
      return bits.length > 0 ? `, ${bits.join(", ")}. ` : ". ";
    };

    let body: string;
    if (balance > 0) {
      const due = (await earliestOpenDueDate(row.leaseId)) ?? todayInNairobi();
      body = toGsm7(
        `${prefix}Received ${formatShillings(row.amount)} for ${row.unitCode}${afterUnit(true)}` +
          `Receipt ${row.receiptNumber}. Balance ${formatShillings(balance)} due ${formatSmsDate(due)}. ${receiptLink}`,
      );
    } else if (balance === 0) {
      body = fitPayingSms({
        required:
          `${prefix}Received ${formatShillings(row.amount)} for ${row.unitCode}${afterUnit(true)}` +
          `Receipt ${row.receiptNumber}. ${month} is fully paid.<<<TY>>> ${receiptLink}`,
        thankYou: " Thank you!",
      });
    } else {
      // Overpaid: omit channel phrase (template 4). Keep credit wording; trim via GSM/fit if needed.
      body = toGsm7(
        `${prefix}Received ${formatShillings(row.amount)} for ${row.unitCode}${afterUnit(false)}` +
          `Receipt ${row.receiptNumber}. ${month} is fully paid and ${formatShillings(-balance)} credit goes to your ${nextMonth} bill. ${receiptLink}`,
      );
      if (body.length > 160) {
        body = toGsm7(
          `${prefix}Received ${formatShillings(row.amount)} for ${row.unitCode}${afterUnit(false)}` +
            `Receipt ${row.receiptNumber}. Fully paid, ${formatShillings(-balance)} credit to ${nextMonth}. ${receiptLink}`,
        );
      }
      if (body.length > 160) body = body.slice(0, 160);
    }

    const { status } = await sendSms({
      to: row.phone,
      body,
      template,
      leaseId: row.leaseId,
      relatedId: paymentId,
      ignoreQuietHours: true,
    });
    if (status === "sent") await getDatabase().update(receipts).set({ sentAt: new Date() }).where(eq(receipts.id, row.receiptId));
  } catch (error) {
    logError(`[notifications] sendReceipt(${paymentId}) failed`, error);
  }
}

/** Tells the landlord a payment couldn't be matched to a lease. Never throws. */
export async function notifyLandlordUnmatched(paymentId: string): Promise<void> {
  try {
    const [[payment], phone] = await Promise.all([
      getDatabase().select().from(payments).where(eq(payments.id, paymentId)).limit(1),
      landlordPhone(),
    ]);
    if (!payment) return;
    if (!phone) {
      console.warn(`[notifications] landlord has no phone; unmatched payment ${paymentId} not texted`);
      return;
    }
    const payer = [payment.payerName, payment.payerPhone].filter(Boolean).join(" ") || "unknown payer";
    const body =
      `${formatShillings(payment.amount)} from ${payer}, account ${payment.accountReference || "(blank)"}, not matched. ` +
      `Assign: ${smsLink(getEnvironment().APP_URL, "/admin/payments")}`;
    await sendSms({ to: phone, body, template: "payment_unmatched", relatedId: paymentId });
  } catch (error) {
    logError(`[notifications] notifyLandlordUnmatched(${paymentId}) failed`, error);
  }
}

/** Texts a tenant their portal login code (any hour). The stored copy hides the code. */
export async function sendLoginCode(phone: string, code: string): Promise<{ status: SendOutcome }> {
  const text = (value: string) => `Your login code is ${value}. Expires in 5 min.`;
  return sendSms({ to: phone, body: text(code), storedBody: text("******"), template: "login_code", ignoreQuietHours: true });
}

/** Texts the landlord their sign-in code (any hour). The stored copy hides the code. */
export async function sendLandlordTwoFactorCode(phone: string, code: string): Promise<{ status: SendOutcome }> {
  const text = (value: string) => `Your admin sign-in code is ${value}. Expires in 5 min. Never share it.`;
  return sendSms({ to: phone, body: text(code), storedBody: text("******"), template: "landlord_two_factor", ignoreQuietHours: true });
}

/**
 * STK push did not complete. Map Daraja result codes to a short reason.
 * Wire from payments/check-stk later. Never throws.
 */
export async function sendStkIncomplete(input: {
  leaseId: string;
  paymentRequestId: string;
  phone: string;
  unitCode: string;
  amount: number;
  resultCode?: string | null;
}): Promise<{ status: SendOutcome }> {
  try {
    const template = "stk_incomplete";
    if (await alreadySent(template, input.leaseId, input.paymentRequestId)) return { status: "skipped" };

    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const reason = stkIncompleteReason(input.resultCode);
    const link = await billLinkOr(input.leaseId, input.unitCode);
    const body = fitPayingSms({
      required: `${prefix}Your payment of ${formatShillings(input.amount)} for ${input.unitCode} was not completed (${reason}). Try again: ${link}`,
      paybill: paybillPart(input.unitCode),
    });
    return sendSms({
      to: input.phone,
      body,
      template,
      leaseId: input.leaseId,
      relatedId: input.paymentRequestId,
      ignoreQuietHours: true,
    });
  } catch (error) {
    logError(`[notifications] sendStkIncomplete(${input.paymentRequestId}) failed`, error);
    return { status: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

/** Balance of a lease up to and including the given ledger entries (compared in SQL: JS dates drop microseconds). */
async function balanceThroughEntriesOf(leaseId: string, invoiceLineIds: readonly string[]): Promise<number> {
  if (invoiceLineIds.length === 0) return leaseBalance(leaseId);
  const [row] = await getDatabase()
    .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::int` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.leaseId, leaseId),
        sql`${ledgerEntries.createdAt} <= (select max(le.created_at) from ledger_entries le where le.invoice_line_id in ${[...invoiceLineIds]})`,
      ),
    );
  return row?.balance ?? 0;
}

/** "{Mon} bill for {unit} is KES {balance}. Due {due}. View and pay: {domain}/bill/{code}". Never throws. */
export async function sendInvoice(invoiceId: string): Promise<{ status: SendOutcome | "not_found" }> {
  try {
    const template = "invoice";
    const database = getDatabase();
    const [invoice] = await database
      .select({
        id: invoices.id,
        leaseId: invoices.leaseId,
        period: invoices.period,
        dueDate: invoices.dueDate,
        unitId: units.id,
        unitCode: units.code,
        phone: tenants.phone,
      })
      .from(invoices)
      .innerJoin(leases, eq(leases.id, invoices.leaseId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .where(eq(invoices.id, invoiceId))
      .limit(1);
    if (!invoice) return { status: "not_found" };
    if (await alreadySent(template, invoice.leaseId, invoice.id)) return { status: "skipped" };

    const lines = await database
      .select({ id: invoiceLines.id })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    const balanceAfter = await balanceThroughEntriesOf(
      invoice.leaseId,
      lines.map((line) => line.id),
    );

    const link = await billLinkOr(invoice.leaseId, invoice.unitCode);
    const body = billSms.bill({
      mon: periodMonthName(invoice.period, "short"),
      unit: invoice.unitCode,
      balance: Math.max(0, balanceAfter),
      due: invoice.dueDate,
      link,
    });

    return sendSms({ to: invoice.phone, body, template, leaseId: invoice.leaseId, relatedId: invoice.id });
  } catch (error) {
    logError(`[notifications] sendInvoice(${invoiceId}) failed`, error);
    return { status: "failed" };
  }
}

/** "A late fee of KES {fee} was added to {unit}. Balance KES {balance}. {domain}/bill/{code}". Never throws. */
export async function sendPenaltyNotice(invoiceLineId: string): Promise<{ status: SendOutcome | "not_found" }> {
  try {
    const template = "penalty_notice";
    const [row] = await getDatabase()
      .select({
        amount: invoiceLines.amount,
        leaseId: invoices.leaseId,
        unitCode: units.code,
        phone: tenants.phone,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .innerJoin(leases, eq(leases.id, invoices.leaseId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .where(eq(invoiceLines.id, invoiceLineId))
      .limit(1);
    if (!row) return { status: "not_found" };
    if (await alreadySent(template, row.leaseId, invoiceLineId)) return { status: "skipped" };

    const balance = await leaseBalance(row.leaseId);
    const link = await billLinkOr(row.leaseId, row.unitCode);
    const body = billSms.lateFee({ unit: row.unitCode, fee: row.amount, balance: Math.max(0, balance), link });
    return sendSms({ to: row.phone, body, template, leaseId: row.leaseId, relatedId: invoiceLineId });
  } catch (error) {
    logError(`[notifications] sendPenaltyNotice(${invoiceLineId}) failed`, error);
    return { status: "failed" };
  }
}

/**
 * Reminders per policy.reminders:
 * (a) daysBeforeDue days before an invoice's due date, if the lease owes anything;
 * (b) daysAfterGrace days after due date + grace, then every repeatEveryDays, while the lease owes.
 * A lease never gets the same template twice on the same (real) day.
 */
export async function sendReminders(input: { today?: IsoDate } = {}) {
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  const resolver = await loadPolicyResolver(database);

  const leaseRows = await database
    .select({ leaseId: leases.id, unitCode: units.code, buildingId: units.buildingId, phone: tenants.phone })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(inArray(leases.status, ["active", "notice"]));
  const leaseIds = leaseRows.map((lease) => lease.leaseId);

  const summary = { sent: 0, skipped: 0, alreadySent: 0, failed: 0, reminders: [] as { unitCode: string; template: string; status: string }[] };
  if (leaseIds.length === 0) return summary;

  const [balances, invoiceRows, sentToday] = await Promise.all([
    database
      .select({ leaseId: ledgerEntries.leaseId, balance: sql<number>`sum(${ledgerEntries.debit} - ${ledgerEntries.credit})::int` })
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.leaseId, leaseIds))
      .groupBy(ledgerEntries.leaseId),
    database
      .select({
        id: invoices.id,
        leaseId: invoices.leaseId,
        period: invoices.period,
        dueDate: invoices.dueDate,
        open: sql<number>`sum("invoice_lines"."amount" - "invoice_lines"."waived_amount" - (select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = "invoice_lines"."id"))::int`,
      })
      .from(invoices)
      .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
      .where(inArray(invoices.leaseId, leaseIds))
      .groupBy(invoices.id)
      .orderBy(asc(invoices.period)),
    database
      .select({ leaseId: messages.leaseId, template: messages.template })
      .from(messages)
      .where(
        and(
          inArray(messages.leaseId, leaseIds),
          inArray(messages.template, ["reminder_before_due", "reminder_overdue"]),
          inArray(messages.status, [...DELIVERED_STATUSES]),
          gte(messages.createdAt, startOfNairobiDay(todayInNairobi())),
        ),
      ),
  ]);
  const balanceByLease = new Map(balances.map((row) => [row.leaseId, row.balance]));
  const alreadySentToday = new Set(sentToday.map((row) => `${row.leaseId}:${row.template}`));

  for (const lease of leaseRows) {
    const balance = balanceByLease.get(lease.leaseId) ?? 0;
    if (balance <= 0) continue;
    const settings = resolver(lease.buildingId, today).settings;
    const own = invoiceRows.filter((invoice) => invoice.leaseId === lease.leaseId);

    const due: { template: "reminder_before_due" | "reminder_overdue"; invoiceId: string; body: string }[] = [];

    const upcoming = own.find((invoice) => invoice.dueDate === addDays(today, settings.reminders.daysBeforeDue));
    if (upcoming) {
      const link = await billLinkOr(lease.leaseId, lease.unitCode);
      due.push({
        template: "reminder_before_due",
        invoiceId: upcoming.id,
        body: billSms.reminder({ unit: lease.unitCode, balance, due: upcoming.dueDate, today, link }),
      });
    }

    const oldestUnpaid = own.find((invoice) => invoice.open > 0);
    if (oldestUnpaid) {
      const firstReminder = addDays(graceEndsOn(oldestUnpaid.dueDate, settings.graceDays), settings.reminders.daysAfterGrace);
      const daysSince = daysBetween(firstReminder, today);
      const repeat = settings.reminders.repeatEveryDays;
      if (daysSince === 0 || (daysSince > 0 && repeat > 0 && daysSince % repeat === 0)) {
        const link = await billLinkOr(lease.leaseId, lease.unitCode);
        const daysOverdue = Math.max(1, daysBetween(oldestUnpaid.dueDate, today));
        due.push({
          template: "reminder_overdue",
          invoiceId: oldestUnpaid.id,
          body: billSms.overdue({ unit: lease.unitCode, balance, days: daysOverdue, link }),
        });
      }
    }

    for (const reminder of due) {
      if (alreadySentToday.has(`${lease.leaseId}:${reminder.template}`)) {
        summary.alreadySent += 1;
        summary.reminders.push({ unitCode: lease.unitCode, template: reminder.template, status: "already_sent_today" });
        continue;
      }
      // before_due is one-shot per invoice; overdue repeats use same-day dedup only (relatedId is uuid).
      if (reminder.template === "reminder_before_due" && (await alreadySent(reminder.template, lease.leaseId, reminder.invoiceId))) {
        summary.alreadySent += 1;
        summary.reminders.push({ unitCode: lease.unitCode, template: reminder.template, status: "already_sent" });
        continue;
      }
      const { status } = await sendSms({
        to: lease.phone,
        body: reminder.body,
        template: reminder.template,
        leaseId: lease.leaseId,
        relatedId: reminder.invoiceId,
      });
      if (status === "sent") alreadySentToday.add(`${lease.leaseId}:${reminder.template}`);
      summary[status === "sent" ? "sent" : status === "skipped" ? "skipped" : "failed"] += 1;
      summary.reminders.push({ unitCode: lease.unitCode, template: reminder.template, status });
    }
  }
  return summary;
}

const MANUAL_REMINDER_TEMPLATE = "reminder_manual";

/** Leases (of those given) that already got a landlord-sent reminder today (Nairobi day). */
export async function leasesRemindedToday(leaseIds: readonly string[]): Promise<Set<string>> {
  if (leaseIds.length === 0) return new Set();
  const rows = await getDatabase()
    .selectDistinct({ leaseId: messages.leaseId })
    .from(messages)
    .where(
      and(
        inArray(messages.leaseId, [...leaseIds]),
        eq(messages.template, MANUAL_REMINDER_TEMPLATE),
        inArray(messages.status, [...DELIVERED_STATUSES]),
        gte(messages.createdAt, startOfNairobiDay(todayInNairobi())),
      ),
    );
  return new Set(rows.map((row) => row.leaseId).filter((id): id is string => id !== null));
}

export type ManualReminderOutcome = SendOutcome | "already_sent_today" | "nothing_owed" | "not_found";

/**
 * Landlord's "Send reminder": texts the reminder (or overdue) wording with the bill link.
 * At most once per lease per day; respects quiet hours.
 */
export async function sendManualReminder(leaseId: string): Promise<{ status: ManualReminderOutcome }> {
  const today = todayInNairobi();
  const database = getDatabase();
  const [[lease], reminded, balance, oldestDue, resolver] = await Promise.all([
    database
      .select({ phone: tenants.phone, unitCode: units.code, buildingId: units.buildingId, status: leases.status })
      .from(leases)
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, leaseId))
      .limit(1),
    leasesRemindedToday([leaseId]),
    leaseBalance(leaseId),
    earliestOpenDueDate(leaseId),
    loadPolicyResolver(database),
  ]);
  if (!lease || lease.status === "ended") return { status: "not_found" };
  if (reminded.has(leaseId)) return { status: "already_sent_today" };
  if (balance <= 0) return { status: "nothing_owed" };

  const link = await billLinkOr(leaseId, lease.unitCode);
  const graceDays = resolver(lease.buildingId, today).settings.graceDays;
  const due = oldestDue ?? today;
  const body =
    oldestDue && graceEndsOn(oldestDue, graceDays) < today
      ? billSms.overdue({ unit: lease.unitCode, balance, days: Math.max(1, daysBetween(oldestDue, today)), link })
      : billSms.reminder({ unit: lease.unitCode, balance, due: due < today ? today : due, today, link });
  const { status } = await sendSms({ to: lease.phone, body, template: MANUAL_REMINDER_TEMPLATE, leaseId });
  return { status };
}

/**
 * Morning summary to the landlord: yesterday's collections, what is owed, unmatched payments
 * and readings to confirm.
 */
export async function sendDailySummary(input: { today?: IsoDate } = {}) {
  const today = input.today ?? todayInNairobi();
  const yesterday = addDays(today, -1);
  const database = getDatabase();

  const [[collected], owed, [unmatched], flagged, phone] = await Promise.all([
    database
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(payments)
      .where(
        and(
          inArray(payments.matchStatus, ["matched", "unmatched"]),
          gte(payments.paidAt, startOfNairobiDay(yesterday)),
          lt(payments.paidAt, startOfNairobiDay(today)),
        ),
      ),
    database
      .select({ leaseId: ledgerEntries.leaseId, balance: sql<number>`sum(${ledgerEntries.debit} - ${ledgerEntries.credit})::int` })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.leaseId)
      .having(sql`sum(${ledgerEntries.debit} - ${ledgerEntries.credit}) > 0`),
    database.select({ count: sql<number>`count(*)::int` }).from(payments).where(eq(payments.matchStatus, "unmatched")),
    countReadingsToConfirm(database),
    landlordPhone(),
  ]);

  const outstanding = sumShillings(owed.map((row) => row.balance));
  const summary = {
    date: yesterday,
    collected: collected?.total ?? 0,
    payments: collected?.count ?? 0,
    outstanding,
    unitsOwing: owed.length,
    unmatched: unmatched?.count ?? 0,
    readingsToConfirm: flagged,
  };
  const body =
    `Yesterday: ${formatShillings(summary.collected)} from ${summary.payments} payments. ` +
    `Owed: ${formatShillings(outstanding)} across ${summary.unitsOwing} units. ` +
    `${summary.unmatched} unmatched, ${summary.readingsToConfirm} readings to confirm.`;

  if (!phone) return { ...summary, status: "no_landlord_phone" as const, body };
  const { status } = await sendSms({ to: phone, body, template: "daily_summary" });
  return { ...summary, status, body };
}

// ---------------------------------------------------------------------------
// Tenancy and claims
// ---------------------------------------------------------------------------

/** "Welcome {firstName}. Unit {unit}. Pay via Paybill {sc} Acc {unit} or {payLink}" */
export async function sendWelcome(leaseId: string): Promise<{ status: SendOutcome | "not_found" }> {
  try {
    const [row] = await getDatabase()
      .select({ name: tenants.fullName, phone: tenants.phone, unitCode: units.code })
      .from(leases)
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, leaseId));
    if (!row) return { status: "not_found" };
    const link = await createPayLink(leaseId);
    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const body = fitSms({
      required: toGsm7(
        `${prefix}Welcome ${firstName(row.name)}. Unit ${row.unitCode}. Pay via Paybill ${getEnvironment().MPESA_SHORTCODE} Acc ${row.unitCode} or ${link}`,
      ),
      optional: [],
    });
    return sendSms({ to: row.phone, body, template: "welcome", leaseId });
  } catch (error) {
    logError(`[notifications] sendWelcome(${leaseId}) failed`, error);
    return { status: "failed" };
  }
}

/** Final statement after move-out, with a link to the full statement. */
export async function sendFinalStatement(input: {
  leaseId: string;
  balance: number;
  depositApplied: number;
  depositRefundDue: number;
}): Promise<{ status: SendOutcome | "not_found" }> {
  try {
    const [row] = await getDatabase()
      .select({ name: tenants.fullName, phone: tenants.phone, unitCode: units.code })
      .from(leases)
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, input.leaseId));
    if (!row) return { status: "not_found" };
    const link = await createPayLink(input.leaseId, { validDays: 30, next: "statement" });
    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const balancePart =
      input.balance > 0
        ? `Balance due ${formatShillings(input.balance)}.`
        : input.balance < 0
          ? `Credit owed ${formatShillings(-input.balance)}.`
          : "Balance KES 0.";
    const applied = input.depositApplied > 0 ? ` Deposit applied ${formatShillings(input.depositApplied)}.` : "";
    const refund = input.depositRefundDue > 0 ? ` Deposit refund ${formatShillings(input.depositRefundDue)}.` : "";
    // Drop refund first, then applied, to stay ≤160 while keeping the statement link.
    const body = fitPayingSms({
      required: `${prefix}Final statement for ${row.unitCode}.<<<BD>>> ${balancePart}<<<TY>>> View: ${link}`,
      breakdown: applied,
      thankYou: refund,
    });
    return sendSms({ to: row.phone, body, template: "final_statement", leaseId: input.leaseId });
  } catch (error) {
    logError(`[notifications] sendFinalStatement(${input.leaseId}) failed`, error);
    return { status: "failed" };
  }
}

/** Tells the landlord a tenant reported a payment that needs checking. */
export async function notifyLandlordClaim(claimId: string, details: { amount: number; unitCode: string; tenantName: string; method: string; reference: string | null }) {
  const phone = await landlordPhone();
  if (!phone) return { status: "skipped" as const };
  const body =
    `Payment claim: ${formatShillings(details.amount)} from ${details.tenantName} (${details.unitCode}) by ${details.method}` +
    `${details.reference ? `, ref ${details.reference}` : ""}. Review: ${smsLink(getEnvironment().APP_URL, "/admin/payments")}`;
  return sendSms({ to: phone, body, template: "payment_claim", relatedId: claimId });
}

/** Confirms to the tenant that their bank/cash/M-Pesa report was received. */
export async function notifyTenantClaimReceived(claimId: string): Promise<{ status: SendOutcome | "not_found" }> {
  try {
    const template = "payment_claim_received";
    const [row] = await getDatabase()
      .select({
        id: paymentClaims.id,
        amount: paymentClaims.amount,
        reference: paymentClaims.reference,
        leaseId: paymentClaims.leaseId,
        phone: tenants.phone,
        unitCode: units.code,
      })
      .from(paymentClaims)
      .innerJoin(leases, eq(leases.id, paymentClaims.leaseId))
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(paymentClaims.id, claimId))
      .limit(1);
    if (!row) return { status: "not_found" };
    if (await alreadySent(template, row.leaseId, claimId)) return { status: "skipped" };

    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const ref = row.reference?.trim();
    const body =
      `${prefix}We got your bank payment report of ${formatShillings(row.amount)}` +
      `${ref ? ` (ref ${ref})` : ""} for ${row.unitCode}. We will text your receipt once it is confirmed.`;
    return sendSms({ to: row.phone, body, template, leaseId: row.leaseId, relatedId: claimId });
  } catch (error) {
    logError(`[notifications] notifyTenantClaimReceived(${claimId}) failed`, error);
    return { status: "failed" };
  }
}

/**
 * Tells the tenant their reported payment was rejected.
 * Looks up unit, reference, and landlord phone from the claim so call sites stay simple.
 */
export async function notifyClaimRejected(input: {
  leaseId: string;
  claimId: string;
  phone: string;
  amount: number;
  reason: string;
  unitCode?: string;
  reference?: string | null;
  landlordPhone?: string | null;
}) {
  try {
    const template = "payment_claim_rejected";
    if (await alreadySent(template, input.leaseId, input.claimId)) return { status: "skipped" as const };

    const [claim] = await getDatabase()
      .select({
        reference: paymentClaims.reference,
        unitCode: units.code,
      })
      .from(paymentClaims)
      .innerJoin(leases, eq(leases.id, paymentClaims.leaseId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(paymentClaims.id, input.claimId))
      .limit(1);

    const unitCode = input.unitCode ?? claim?.unitCode ?? "your unit";
    const reference = (input.reference ?? claim?.reference)?.trim() || null;
    const phone = input.landlordPhone ?? (await landlordPhone());
    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const body =
      `${prefix}Your payment report of ${formatShillings(input.amount)}` +
      `${reference ? ` (ref ${reference})` : ""} for ${unitCode} was not confirmed: ${input.reason}.` +
      `${phone ? ` Questions? Call ${phone}` : ""}`;
    return sendSms({ to: input.phone, body, template, leaseId: input.leaseId, relatedId: input.claimId });
  } catch (error) {
    logError(`[notifications] notifyClaimRejected(${input.claimId}) failed`, error);
    return { status: "failed" as const };
  }
}

/** Tells the tenant a payment was reversed. */
export async function notifyPaymentReversed(paymentId: string, reason: string) {
  try {
    const template = "payment_reversed";
    const [row] = await getDatabase()
      .select({
        amount: payments.amount,
        receipt: payments.mpesaReceipt,
        raw: payments.raw,
        channel: payments.channel,
        leaseId: payments.leaseId,
        phone: tenants.phone,
        unitCode: units.code,
      })
      .from(payments)
      .innerJoin(leases, eq(leases.id, payments.leaseId))
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(payments.id, paymentId));
    if (!row || !row.leaseId) return { status: "skipped" as const };
    if (await alreadySent(template, row.leaseId, paymentId)) return { status: "skipped" as const };

    const balance = await leaseBalance(row.leaseId);
    const phone = await landlordPhone();
    const ref =
      row.receipt ||
      (row.raw && typeof row.raw === "object" && "reference" in row.raw
        ? String((row.raw as { reference?: unknown }).reference ?? "").trim()
        : "") ||
      "recorded";
    const prefix = smsPrefix(getEnvironment().APP_NAME);
    const body =
      `${prefix}Payment ${ref} of ${formatShillings(row.amount)} for ${row.unitCode} was reversed (${reason}). ` +
      `Balance ${formatShillings(Math.max(0, balance))}.` +
      `${phone ? ` Questions? Call ${phone}` : ""}`;
    return sendSms({ to: row.phone, body, template, leaseId: row.leaseId, relatedId: paymentId });
  } catch (error) {
    logError(`[notifications] notifyPaymentReversed(${paymentId}) failed`, error);
    return { status: "failed" as const };
  }
}

// ---------------------------------------------------------------------------
// Reads, templates, preview
// ---------------------------------------------------------------------------

/** The SMS wording, for the read-only templates page. Placeholders are in {braces}. */
export const MESSAGE_TEMPLATES = [
  { template: "welcome", name: "Welcome", wording: "{APP}: Welcome {firstName}. Unit {unitCode}. Pay via Paybill {shortcode} Acc {unitCode} or {payLink}" },
  { template: "invoice", name: "New bill", wording: "{APP}: {Mon} bill for {unitCode} is KES {balance}. Due {due}. View and pay: {domain}/bill/{code}" },
  { template: "reminder_before_due", name: "Reminder before due date", wording: "{APP}: Reminder, KES {balance} for {unitCode} is due {tomorrow|on {due}}. View and pay: {domain}/bill/{code}" },
  { template: "reminder_overdue", name: "Overdue reminder", wording: "{APP}: KES {balance} for {unitCode} is {n} days overdue. Please pay today: {domain}/bill/{code}" },
  { template: "reminder_manual", name: "Reminder sent by landlord", wording: "Same wording as the reminder before due date, or the overdue reminder once past due + grace. Once per lease per day." },
  { template: "penalty_notice", name: "Late fee", wording: "{APP}: A late fee of KES {fee} was added to {unitCode}. Balance KES {balance}. {domain}/bill/{code}" },
  { template: "payment_receipt", name: "Receipt", wording: "{APP}: Received KES {amount} for {unitCode}, M-Pesa {ref}. Receipt {number}. Balance KES {balance} due {due}. {receiptLink} (or fully paid / overpaid variants)" },
  { template: "stk_incomplete", name: "STK incomplete", wording: "{APP}: Your payment of KES {amount} for {unitCode} was not completed ({reason}). Try again: {domain}/bill/{code} or Paybill {shortcode} Acc {unitCode}" },
  { template: "payment_claim_received", name: "Payment claim received", wording: "{APP}: We got your bank payment report of KES {amount} (ref {ref}) for {unitCode}. We will text your receipt once it is confirmed." },
  { template: "payment_reversed", name: "Payment reversed", wording: "{APP}: Payment {ref} of KES {amount} for {unitCode} was reversed ({reason}). Balance KES {balance}. Questions? Call {landlordPhone}" },
  { template: "payment_claim_rejected", name: "Reported payment rejected", wording: "{APP}: Your payment report of KES {amount} (ref {ref}) for {unitCode} was not confirmed: {reason}. Questions? Call {landlordPhone}" },
  { template: "opening_balance", name: "Opening balance (after an import)", wording: "{APP}: Your account for {unitCode} is now on {APP}. Opening balance KES {n} {owed|credit}. Questions? Call {landlordPhone}" },
  { template: "statement", name: "Statement link", wording: "{APP}: Statement for {unitCode}: Balance KES {balance}. View: {statementLink}" },
  { template: "final_statement", name: "Final statement", wording: "{APP}: Final statement for {unitCode}. Balance…. View: {statementLink}" },
  { template: "login_code", name: "Tenant login code", wording: "{APP}: Your login code is {code}. Expires in 5 min." },
  { template: "phone_change_code", name: "Confirm a new phone number", wording: "{APP}: Your code to confirm this number is {code}. Expires in 5 min." },
  { template: "landlord_two_factor", name: "Landlord sign-in code", wording: "{APP}: Your admin sign-in code is {code}. Expires in 5 min. Never share it." },
  { template: "payment_unmatched", name: "Unmatched payment (to landlord)", wording: "{APP}: KES {amount} from {payer}, account {account}, not matched. Assign: {link}" },
  { template: "payment_claim", name: "Payment claim (to landlord)", wording: "{APP}: Payment claim: KES {amount} from {tenant} ({unitCode}) by {method}, ref {reference}. Review: {link}" },
  { template: "daily_summary", name: "Daily summary (to landlord)", wording: "{APP}: Yesterday: KES {collected} from {count} payments. Owed: KES {outstanding} across {units} units. {unmatched} unmatched, {flagged} readings to confirm." },
] as const;

/** Message log, newest first, filtered by tenant name/phone and template. */
export async function listMessages(filter: { search?: string; template?: string; leaseId?: string; limit?: number } = {}) {
  const search = filter.search?.trim();
  return getDatabase()
    .select({
      id: messages.id,
      createdAt: messages.createdAt,
      recipient: messages.recipient,
      template: messages.template,
      body: messages.body,
      status: messages.status,
      cost: messages.cost,
      tenantName: tenants.fullName,
      unitCode: units.code,
    })
    .from(messages)
    .leftJoin(leases, eq(leases.id, messages.leaseId))
    .leftJoin(tenants, eq(tenants.id, leases.tenantId))
    .leftJoin(units, eq(units.id, leases.unitId))
    .where(
      and(
        filter.template ? eq(messages.template, filter.template) : undefined,
        filter.leaseId ? eq(messages.leaseId, filter.leaseId) : undefined,
        search ? sql`(${tenants.fullName} ilike ${`%${search}%`} or ${messages.recipient} like ${`%${search.replace(/\D/g, "").replace(/^0/, "")}%`})` : undefined,
      ),
    )
    .orderBy(sql`${messages.createdAt} desc`)
    .limit(filter.limit ?? 200);
}

/** Texts the tenant their balance with a link to the statement. */
export async function sendStatementLink(leaseId: string): Promise<{ status: SendOutcome | "not_found" }> {
  const [row] = await getDatabase()
    .select({ phone: tenants.phone, unitCode: units.code })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (!row) return { status: "not_found" };
  const balance = await leaseBalance(leaseId);
  const link = await createPayLink(leaseId, { validDays: 14, next: "statement" });
  const prefix = smsPrefix(getEnvironment().APP_NAME);
  return sendSms({
    to: row.phone,
    body: `${prefix}Statement for ${row.unitCode}: ${describeBalance(balance)}. View: ${link}`,
    template: "statement",
    leaseId,
  });
}

/**
 * Renders every tenant/landlord SMS template for a lease with real data (or sample fallbacks).
 * Does not send. Used by the sandbox preview endpoint.
 */
export async function previewSmsTemplates(leaseId: string): Promise<{ template: string; body: string; length: number }[]> {
  const env = getEnvironment();
  const prefix = smsPrefix(env.APP_NAME);
  const database = getDatabase();

  const [lease] = await database
    .select({
      leaseId: leases.id,
      phone: tenants.phone,
      name: tenants.fullName,
      unitCode: units.code,
    })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId))
    .limit(1);

  const unit = lease?.unitCode ?? "A1";
  const name = lease ? firstName(lease.name) : "Jane";
  const balance = lease ? await leaseBalance(lease.leaseId) : 15_640;
  const period = lease ? ((await latestInvoicePeriod(lease.leaseId)) ?? todayInNairobi().slice(0, 7)) : todayInNairobi().slice(0, 7);
  const mon = periodMonthName(period, "short");
  const month = periodMonthName(period, "long");
  const nextMonth = periodMonthName(addMonthsToPeriod(period, 1), "long");
  const due = formatSmsDate(addDays(todayInNairobi(), 5));
  const payLink = lease ? await createPayLink(lease.leaseId) : smsLink(env.APP_URL, "/pay-link/SAMPLEPAYLNK");
  const billLink = smsLink(env.APP_URL, "/bill/SampleCode12");
  const today = todayInNairobi();
  const dueIso = addDays(today, 5);
  const balanceValue = Math.max(0, balance) || 15_640;
  const receiptLink = smsLink(env.APP_URL, "/receipts/SampleRcpt1");
  const landlord = (await landlordPhone()) ?? "0712345678";
  const shortcode = env.MPESA_SHORTCODE;
  const amount = formatShillings(15_000);
  const sampleBalance = formatShillings(Math.max(0, balance) || 15_640);

  const samples: { template: string; body: string }[] = [
    {
      template: "welcome",
      body: `${prefix}Welcome ${name}. Unit ${unit}. Pay via Paybill ${shortcode} Acc ${unit} or ${payLink}`,
    },
    { template: "invoice", body: billSms.bill({ mon, unit, balance: balanceValue, due: dueIso, link: billLink }) },
    { template: "reminder_before_due", body: billSms.reminder({ unit, balance: balanceValue, due: addDays(today, 1), today, link: billLink }) },
    { template: "reminder_before_due_on_date", body: billSms.reminder({ unit, balance: balanceValue, due: dueIso, today, link: billLink }) },
    { template: "reminder_overdue", body: billSms.overdue({ unit, balance: balanceValue, days: 12, link: billLink }) },
    { template: "penalty_notice", body: billSms.lateFee({ unit, fee: 1_500, balance: balanceValue + 1_500, link: billLink }) },
    {
      template: "payment_receipt",
      body: `${prefix}Received ${amount} for ${unit}, M-Pesa QH123. Receipt RCT-000001. Balance ${sampleBalance} due ${due}. ${receiptLink}`,
    },
    {
      template: "payment_receipt_paid",
      body: fitPayingSms({
        required: `${prefix}Received ${amount} for ${unit}, M-Pesa QH123. Receipt RCT-000001. ${month} is fully paid.<<<TY>>> ${receiptLink}`,
        thankYou: " Thank you!",
      }),
    },
    {
      template: "payment_receipt_overpaid",
      body: (() => {
        let text =
          `${prefix}Received ${amount} for ${unit}. Receipt RCT-000001. ${month} is fully paid and ${formatShillings(360)} credit goes to your ${nextMonth} bill. ${receiptLink}`;
        if (toGsm7(text).length > 160) {
          text = `${prefix}Received ${amount} for ${unit}. Receipt RCT-000001. Fully paid, ${formatShillings(360)} credit to ${nextMonth}. ${receiptLink}`;
        }
        return text;
      })(),
    },
    {
      template: "stk_incomplete",
      body: fitPayingSms({
        required: `${prefix}Your payment of ${amount} for ${unit} was not completed (cancelled). Try again: ${billLink}`,
        paybill: paybillPart(unit),
      }),
    },
    {
      template: "payment_claim_received",
      body: `${prefix}We got your bank payment report of ${amount} (ref TX123) for ${unit}. We will text your receipt once it is confirmed.`,
    },
    {
      template: "payment_claim_rejected",
      body: `${prefix}Your payment report of ${amount} (ref TX123) for ${unit} was not confirmed: could not find deposit. Questions? Call ${landlord}`,
    },
    {
      template: "payment_reversed",
      body: `${prefix}Payment QH123 of ${amount} for ${unit} was reversed (duplicate). Balance ${sampleBalance}. Questions? Call ${landlord}`,
    },
    {
      template: "opening_balance",
      body: `${prefix}Your account for ${unit} is now on ${env.APP_NAME}. Opening balance ${sampleBalance} owed. Questions? Call ${landlord}`,
    },
    {
      template: "statement",
      body: `${prefix}Statement for ${unit}: ${describeBalance(balance)}. View: ${payLink}`,
    },
    {
      template: "final_statement",
      body: `${prefix}Final statement for ${unit}. Balance due ${sampleBalance}. View: ${payLink}`,
    },
    {
      template: "login_code",
      body: `${prefix}Your login code is 123456. Expires in 5 min.`,
    },
    {
      template: "landlord_two_factor",
      body: `${prefix}Your admin sign-in code is 123456. Expires in 5 min. Never share it.`,
    },
    {
      template: "phone_change_code",
      body: `${prefix}Your code to confirm this number is 123456. Expires in 5 min.`,
    },
    {
      template: "payment_unmatched",
      body: `${prefix}${amount} from Jane 2547…, account ${unit}, not matched. Assign: ${smsLink(env.APP_URL, "/admin/payments")}`,
    },
    {
      template: "payment_claim",
      body: `${prefix}Payment claim: ${amount} from ${name} (${unit}) by bank, ref TX123. Review: ${smsLink(env.APP_URL, "/admin/payments")}`,
    },
    {
      template: "daily_summary",
      body: `${prefix}Yesterday: ${formatShillings(45_000)} from 3 payments. Owed: ${formatShillings(120_000)} across 8 units. 1 unmatched, 2 readings to confirm.`,
    },
  ];

  return samples.map((sample) => {
    const body = toGsm7(sample.body.startsWith(prefix) ? sample.body : `${prefix}${sample.body}`);
    return { template: sample.template, body, length: body.length };
  });
}
