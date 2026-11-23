import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { checkLoginCode, issueLoginCode } from "@/authentication/login-codes";
import { getEnvironment } from "@/configuration/environment";
import { dueDateFor, graceEndsOn } from "@/core/billing";
import { unitPaymentStatus } from "@/core/status";
import { getDatabase } from "@/database/client";
import { fetchOffsetPage } from "@/database/keyset";
import type { PageRequest } from "@/utilities/pagination";
import {
  allocations,
  buildings,
  invoiceLines,
  invoices,
  leases,
  meterReadings,
  paymentRequests,
  payments,
  receipts,
  tenants,
  units,
} from "@/database/schema";
import { addMonthsToPeriod, currentPeriod, periodOf, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { writeAudit } from "./audit";
import { listInvoicesForLease } from "./billing";
import { ServiceError } from "./errors";
import { sendSms } from "./notifications";
import { getPolicy } from "./policies";
import { leaseBalance } from "./tenancy";

/**
 * The lease a tenant session is looking at: the chosen lease if the session has one (it may have ended, e.g. after
 * a statement link), otherwise their newest current lease, otherwise their newest lease.
 */
export async function getTenantLease(tenantId: string, leaseId?: string | null) {
  const rows = await getDatabase()
    .select({
      leaseId: leases.id,
      status: leases.status,
      startDate: leases.startDate,
      endDate: leases.endDate,
      rentAmount: leases.rentAmount,
      unitId: units.id,
      unitCode: units.code,
      buildingId: units.buildingId,
      buildingName: buildings.name,
      tenantName: tenants.fullName,
      tenantPhone: tenants.phone,
      tenantAvatarKey: tenants.avatarKey,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(and(eq(leases.tenantId, tenantId), leaseId ? eq(leases.id, leaseId) : undefined))
    .orderBy(sql`case when ${leases.status} = 'ended' then 1 else 0 end`, desc(leases.startDate))
    .limit(1);
  const lease = rows[0];
  return lease ? { ...lease, isCurrent: lease.status !== "ended" } : null;
}

export type TenantLease = NonNullable<Awaited<ReturnType<typeof getTenantLease>>>;

/** Bank details shown to tenants (from the environment), or null when none are set. */
export function getBankDetails() {
  const environment = getEnvironment();
  const details = {
    bankName: environment.BANK_NAME ?? null,
    branch: environment.BANK_BRANCH ?? null,
    accountName: environment.BANK_ACCOUNT_NAME ?? null,
    accountNumber: environment.BANK_ACCOUNT_NUMBER ?? null,
  };
  return Object.values(details).some(Boolean) ? details : null;
}

/** Everything the tenant home screen shows. */
export async function getTenantHome(lease: TenantLease, today: IsoDate = todayInNairobi()) {
  const database = getDatabase();
  const [balance, bills, [lastPayment], policy] = await Promise.all([
    leaseBalance(lease.leaseId),
    listInvoicesForLease(lease.leaseId),
    database
      .select({ amount: payments.amount, paidAt: payments.paidAt, mpesaReceipt: payments.mpesaReceipt, receiptToken: receipts.token, receiptNumber: receipts.number })
      .from(payments)
      .leftJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(and(eq(payments.leaseId, lease.leaseId), eq(payments.matchStatus, "matched")))
      .orderBy(desc(payments.paidAt))
      .limit(1),
    getPolicy(lease.buildingId, today),
  ]);

  const oldestOpen = [...bills].reverse().find((bill) => bill.open > 0) ?? null;
  const thisMonthDue = dueDateFor(currentPeriod(), policy.settings.dueDay);
  const nextDue = today <= thisMonthDue ? thisMonthDue : dueDateFor(addMonthsToPeriod(currentPeriod(), 1), policy.settings.dueDay);
  const paidThisPeriod = lastPayment && periodOf(todayInNairobi(lastPayment.paidAt)) === periodOf(today) ? lastPayment.amount : 0;
  const status = unitPaymentStatus({
    hasCurrentLease: lease.isCurrent,
    balance,
    paidThisPeriod,
    today,
    graceEndsOn: oldestOpen ? graceEndsOn(oldestOpen.dueDate, policy.settings.graceDays) : null,
  });

  return {
    firstName: lease.tenantName.split(" ")[0] ?? lease.tenantName,
    balance,
    dueDate: balance > 0 ? (oldestOpen?.dueDate ?? nextDue) : nextDue,
    status,
    lastPayment: lastPayment ?? null,
    paybill: getEnvironment().MPESA_SHORTCODE,
  };
}

/**
 * Billed (invoice totals) and paid (matched payments, by Nairobi month) for the lease, for `months` months ending
 * this month. Months before the lease started are left out.
 */
export async function getTenantTrend(lease: TenantLease, months = 6, today: IsoDate = todayInNairobi()) {
  const end = periodOf(today);
  const first = addMonthsToPeriod(end, -(months - 1));
  const database = getDatabase();
  const [billedRows, paidRows] = await Promise.all([
    database.execute(sql`
      select i.period, coalesce(sum(il.amount - il.waived_amount), 0)::int as amount
      from invoices i join invoice_lines il on il.invoice_id = i.id
      where i.lease_id = ${lease.leaseId} and i.period >= ${first} and i.period <= ${end}
      group by i.period`),
    database.execute(sql`
      select to_char(p.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM') as period, coalesce(sum(p.amount), 0)::int as amount
      from payments p
      where p.lease_id = ${lease.leaseId} and p.match_status = 'matched'
        and to_char(p.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM') >= ${first}
      group by 1`),
  ]);
  const billed = new Map(([...billedRows] as { period: string; amount: number }[]).map((row) => [row.period, row.amount]));
  const paid = new Map(([...paidRows] as { period: string; amount: number }[]).map((row) => [row.period, row.amount]));
  const startPeriod = periodOf(lease.startDate);
  return Array.from({ length: months }, (_, index) => addMonthsToPeriod(first, index))
    .filter((period) => period >= startPeriod)
    .map((period) => ({ period, billed: billed.get(period) ?? 0, paid: paid.get(period) ?? 0 }));
}

/** A tenant's bills, newest first, with total, open amount and status. */
export async function listTenantBills(lease: TenantLease, today: IsoDate = todayInNairobi()) {
  const [bills, policy] = await Promise.all([listInvoicesForLease(lease.leaseId), getPolicy(lease.buildingId, today)]);
  return bills.map((bill) => ({
    ...bill,
    status:
      bill.open === 0
        ? ("paid" as const)
        : today > graceEndsOn(bill.dueDate, policy.settings.graceDays)
          ? ("overdue" as const)
          : bill.paid > 0
            ? ("partial" as const)
            : ("unpaid" as const),
  }));
}

/** One bill with its lines (water with readings), waived amounts and the payments that covered it. */
export async function getTenantBill(lease: TenantLease, invoiceId: string) {
  const database = getDatabase();
  const [invoice] = await database
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.leaseId, lease.leaseId)));
  if (!invoice) return null;

  const [lines, paidBy, [reading]] = await Promise.all([
    database
      .select({
        id: invoiceLines.id,
        type: invoiceLines.type,
        description: invoiceLines.description,
        quantity: invoiceLines.quantity,
        rate: invoiceLines.rate,
        amount: invoiceLines.amount,
        waived: invoiceLines.waivedAmount,
        paid: sql<number>`(select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = "invoice_lines"."id")::int`,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
      .orderBy(asc(invoiceLines.createdAt)),
    database
      .select({
        paymentId: payments.id,
        paidAt: payments.paidAt,
        mpesaReceipt: payments.mpesaReceipt,
        receiptToken: receipts.token,
        receiptNumber: receipts.number,
        amount: sql<number>`sum(${allocations.amount})::int`,
      })
      .from(allocations)
      .innerJoin(invoiceLines, eq(invoiceLines.id, allocations.invoiceLineId))
      .innerJoin(payments, eq(payments.id, allocations.paymentId))
      .leftJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(eq(invoiceLines.invoiceId, invoice.id))
      .groupBy(payments.id, payments.paidAt, payments.mpesaReceipt, receipts.token, receipts.number)
      .having(sql`sum(${allocations.amount}) > 0`)
      .orderBy(asc(payments.paidAt)),
    database
      .select({ previousReading: meterReadings.previousReading, currentReading: meterReadings.currentReading })
      .from(meterReadings)
      .where(and(eq(meterReadings.unitId, lease.unitId), eq(meterReadings.period, addMonthsToPeriod(invoice.period, -1)), eq(meterReadings.kind, "regular")))
      .limit(1),
  ]);

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const waived = lines.reduce((sum, line) => sum + line.waived, 0);
  const paid = lines.reduce((sum, line) => sum + line.paid, 0);
  return { invoice, lines, paidBy, waterReading: reading ?? null, total, waived, paid, open: Math.max(0, total - waived - paid) };
}

/** Receipts for the lease, newest first. */
function tenantReceiptQuery(lease: TenantLease) {
  return getDatabase()
    .select({
      paymentId: payments.id,
      paidAt: payments.paidAt,
      amount: payments.amount,
      channel: payments.channel,
      mpesaReceipt: payments.mpesaReceipt,
      reference: sql<string | null>`${payments.raw}->>'reference'`,
      receiptNumber: receipts.number,
      receiptToken: receipts.token,
      voided: sql<boolean>`${receipts.voidedAt} is not null`,
    })
    .from(receipts)
    .innerJoin(payments, eq(payments.id, receipts.paymentId))
    .where(eq(payments.leaseId, lease.leaseId))
    .orderBy(desc(payments.paidAt), desc(payments.id))
    .$dynamic();
}

export async function listTenantReceipts(lease: TenantLease) {
  return tenantReceiptQuery(lease);
}

/** One page (25) of the tenant's receipts, newest first. */
export async function pageTenantReceipts(lease: TenantLease, request: PageRequest) {
  return fetchOffsetPage({
    request,
    count: async () =>
      (
        await getDatabase()
          .select({ count: sql<number>`count(*)::int` })
          .from(receipts)
          .innerJoin(payments, eq(payments.id, receipts.paymentId))
          .where(eq(payments.leaseId, lease.leaseId))
      )[0]?.count ?? 0,
    fetch: (limit, offset) => tenantReceiptQuery(lease).limit(limit).offset(offset),
  });
}

// ---- STK progress ----

const PLAIN_REASONS: Record<string, string> = {
  "1032": "You cancelled the M-Pesa request on your phone.",
  "1037": "The request timed out before the PIN was entered. Your phone may have been off or out of network.",
  "1": "Your M-Pesa balance wasn't enough for this payment.",
  "2001": "The M-Pesa PIN entered was wrong.",
  "1001": "Another M-Pesa payment was in progress. Wait a minute and try again.",
  "1019": "The request expired before it was completed.",
  "1025": "M-Pesa couldn't send the prompt to your phone.",
  "9999": "M-Pesa couldn't send the prompt to your phone.",
};

/** Daraja's result in plain words for tenants. */
export function plainPaymentFailure(resultCode: string | null, description: string | null): string {
  return (resultCode && PLAIN_REASONS[resultCode]) ?? description ?? "M-Pesa didn't complete the payment.";
}

/** Status of a tenant's STK request (only their own), with what the "paid" and "failed" screens need. */
export async function getPaymentProgress(tenantId: string, requestId: string) {
  const database = getDatabase();
  const [row] = await database
    .select({
      id: paymentRequests.id,
      leaseId: paymentRequests.leaseId,
      status: paymentRequests.status,
      amount: paymentRequests.amount,
      resultCode: paymentRequests.resultCode,
      resultDescription: paymentRequests.resultDescription,
      createdAt: paymentRequests.createdAt,
      lastCheckedAt: paymentRequests.lastCheckedAt,
      tenantId: leases.tenantId,
      mpesaReceipt: payments.mpesaReceipt,
      paidAmount: payments.amount,
      receiptToken: receipts.token,
    })
    .from(paymentRequests)
    .innerJoin(leases, eq(leases.id, paymentRequests.leaseId))
    .leftJoin(payments, eq(payments.id, paymentRequests.paymentId))
    .leftJoin(receipts, eq(receipts.paymentId, paymentRequests.paymentId))
    .where(eq(paymentRequests.id, requestId))
    .limit(1);
  if (!row || row.tenantId !== tenantId) return null;
  return {
    ...row,
    amount: row.paidAmount ?? row.amount,
    reason: row.status === "pending" || row.status === "paid" ? null : plainPaymentFailure(row.resultCode, row.resultDescription),
    balance: row.status === "paid" ? await leaseBalance(row.leaseId) : null,
  };
}

// ---- Phone number changes (verified by SMS to the new number) ----

export type PhoneField = "phone" | "alternativePhone";

/** Sends a code to the new number. The change is only made once that code is entered. */
export async function requestPhoneChange(input: { tenantId: string; field: PhoneField; newPhone: string }) {
  const phone = normaliseKenyanPhone(input.newPhone);
  if (!phone) throw new ServiceError("Enter a valid Kenyan mobile number");
  const database = getDatabase();
  const [tenant] = await database.select({ phone: tenants.phone, alternativePhone: tenants.alternativePhone }).from(tenants).where(eq(tenants.id, input.tenantId));
  if (!tenant) throw new ServiceError("Account not found");
  if (tenant[input.field] === phone) throw new ServiceError("That is already your number");
  if (input.field === "phone") {
    const [taken] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.phone, phone));
    if (taken) throw new ServiceError("That number is already used by another account");
  }
  const issued = await issueLoginCode(phone, "phone_change");
  if (!issued.issued) throw new ServiceError("Too many codes requested. Try again in 15 minutes.");
  const text = (value: string) => `Your code to confirm this number is ${value}. Expires in 5 min.`;
  await sendSms({
    to: phone,
    body: text(issued.code),
    storedBody: text("******"),
    template: "phone_change_code",
    ignoreQuietHours: true,
  });
  return { phone };
}

export async function confirmPhoneChange(input: { tenantId: string; field: PhoneField; newPhone: string; code: string }) {
  const phone = normaliseKenyanPhone(input.newPhone);
  if (!phone) throw new ServiceError("Enter a valid Kenyan mobile number");
  const check = await checkLoginCode(phone, input.code, "phone_change");
  if (!check.valid) {
    throw new ServiceError(
      check.reason === "wrong" ? `That code isn't right. You have ${check.attemptsLeft} ${check.attemptsLeft === 1 ? "try" : "tries"} left.` : "That code has expired. Send a new one.",
    );
  }
  return getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select().from(tenants).where(eq(tenants.id, input.tenantId)).for("update");
    if (!before) throw new ServiceError("Account not found");
    try {
      await transaction.update(tenants).set({ [input.field]: phone }).where(eq(tenants.id, input.tenantId));
    } catch {
      throw new ServiceError("That number is already used by another account");
    }
    await writeAudit(transaction, {
      actor: `tenant:${input.tenantId}`,
      action: "tenant.phone_change",
      entity: "tenant",
      entityId: input.tenantId,
      before: { [input.field]: before[input.field] },
      after: { [input.field]: phone },
      reason: "Verified by SMS code to the new number",
    });
    return { field: input.field, phone };
  });
}

export async function setWhatsappOptIn(tenantId: string, optIn: boolean) {
  await getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select({ whatsappOptIn: tenants.whatsappOptIn }).from(tenants).where(eq(tenants.id, tenantId));
    if (!before) throw new ServiceError("Account not found");
    await transaction.update(tenants).set({ whatsappOptIn: optIn }).where(eq(tenants.id, tenantId));
    await writeAudit(transaction, { actor: `tenant:${tenantId}`, action: "tenant.whatsapp_opt_in", entity: "tenant", entityId: tenantId, before, after: { whatsappOptIn: optIn } });
  });
}

export async function getTenantProfile(tenantId: string) {
  const [row] = await getDatabase()
    .select({ fullName: tenants.fullName, phone: tenants.phone, alternativePhone: tenants.alternativePhone, whatsappOptIn: tenants.whatsappOptIn, avatarKey: tenants.avatarKey })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return row ?? null;
}


/** Whole calendar months from one ISO date to another (0 if the end is before the start). */
function wholeMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

/**
 * The profile card's numbers, all from the ledger and payments (none invented):
 * - tenantSince: the first lease's start date.
 * - monthsAsTenant: whole months from then until today (or the last lease's end if every lease has ended).
 * - paymentsMade: matched payments on any of the tenant's leases (opening balances brought in at import are not payments).
 * - onTimePercent: of bills already past their due date (opening arrears excluded), the share fully covered by
 *   payments made on or before the due date. Null when no bill has fallen due yet.
 */
export async function getTenantProfileStats(tenantId: string, today: IsoDate = todayInNairobi()) {
  const database = getDatabase();
  const [[span], [paid], [bills]] = await Promise.all([
    database.execute(sql`
      select min(start_date)::text as "since", bool_or(status <> 'ended') as "current", max(end_date)::text as "lastEnd"
      from leases where tenant_id = ${tenantId}`),
    database.execute(sql`
      select count(*)::int as "count"
      from payments p join leases l on l.id = p.lease_id
      where l.tenant_id = ${tenantId} and p.match_status = 'matched' and p.source <> 'opening'`),
    database.execute(sql`
      with due as (
        select i.id, i.due_date, sum(il.amount - il.waived_amount) as total
        from invoices i
        join leases l on l.id = i.lease_id
        join invoice_lines il on il.invoice_id = i.id
        where l.tenant_id = ${tenantId} and i.source <> 'opening' and i.due_date <= ${today}
        group by i.id, i.due_date
      ),
      paid_in_time as (
        select il.invoice_id, sum(a.amount) as amount
        from allocations a
        join invoice_lines il on il.id = a.invoice_line_id
        join payments p on p.id = a.payment_id
        join due on due.id = il.invoice_id
        where (p.paid_at at time zone 'Africa/Nairobi')::date <= due.due_date
        group by il.invoice_id
      )
      select count(*) filter (where due.total > 0)::int as "due",
             count(*) filter (where due.total > 0 and coalesce(paid_in_time.amount, 0) >= due.total)::int as "onTime"
      from due left join paid_in_time on paid_in_time.invoice_id = due.id`),
  ]);
  const { since, current, lastEnd } = span as { since: string | null; current: boolean | null; lastEnd: string | null };
  const { count } = paid as { count: number };
  const { due, onTime } = bills as { due: number; onTime: number };
  return {
    tenantSince: since,
    monthsAsTenant: since ? wholeMonthsBetween(since, current || !lastEnd ? today : lastEnd) : 0,
    paymentsMade: count,
    onTimePercent: due > 0 ? Math.round((onTime / due) * 100) : null,
    billsDue: due,
  };
}
