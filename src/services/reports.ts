import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { graceEndsOn } from "@/core/billing";
import { unitPaymentStatus, type UnitPaymentStatus } from "@/core/status";
import { getDatabase } from "@/database/client";
import {
  addDays,
  addMonthsToPeriod,
  assertBillingPeriod,
  assertIsoDate,
  daysBetween,
  earlierDate,
  firstDayOfPeriod,
  formatNairobiDateTime,
  laterDate,
  periodOf,
  startOfNairobiDay,
  todayInNairobi,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";
import { sumShillings } from "@/utilities/money";
import { loadPolicyResolver } from "./policies";

/** Kenya Monthly Rental Income tax rate used for the estimate (check the current KRA rate before filing). */
export const RENTAL_INCOME_TAX_PERCENT = 7.5;

async function query<T>(statement: SQL): Promise<T[]> {
  return [...(await getDatabase().execute(statement))] as T[];
}

/** Rows → CSV text (header from the first row's keys). */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as object);
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
}

/** Raw queries get timestamps as ISO text (a JS Date would be sent as Date.toString(), which Postgres rejects). */
const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const buildingFilter = (buildingId: string | null | undefined, column: SQL) => (buildingId ? sql`and ${column} = ${buildingId}` : sql``);

/** Start (inclusive) and end (exclusive) instants of a period in Nairobi time. */
function periodBounds(period: BillingPeriod): [Date, Date] {
  return [startOfNairobiDay(firstDayOfPeriod(period)), startOfNairobiDay(firstDayOfPeriod(addMonthsToPeriod(period, 1)))];
}

// Open amount of a line = amount − allocations − waived (SQL fragment for "il").
const LINE_ALLOCATED = sql.raw(`(select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = il.id)`);
const LINE_OPEN = sql.raw(`(il.amount - il.waived_amount - (select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = il.id))`);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type BoardUnit = {
  unitId: string;
  unitCode: string;
  unitStatus: string;
  paymentStatus: UnitPaymentStatus;
  leaseId: string | null;
  leaseStatus: "active" | "notice" | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantPhone: string | null;
  balance: number;
  expected: number;
  collected: number;
  /** Due date of the oldest invoice that still has an open amount. */
  oldestOpenDue: IsoDate | null;
};

/**
 * Every unit (optionally of one building) with its tenant, balance and status from core/status, grouped by building.
 * Status is as of `today`; expected and collected are for `period` (default: the month of `today`).
 */
export async function unitStatusBoard(input: { today?: IsoDate; period?: BillingPeriod; buildingId?: string | null } = {}) {
  const today = input.today ?? todayInNairobi();
  const period = input.period ? assertBillingPeriod(input.period) : periodOf(today);
  const statusPeriod = periodOf(today);
  const [periodStart, periodEnd] = periodBounds(statusPeriod);
  const [resolver, unitRows, leaseRows] = await Promise.all([
    loadPolicyResolver(),
    query<{ unitId: string; unitCode: string; unitStatus: string; buildingId: string; buildingName: string }>(sql`
      select u.id as "unitId", u.code as "unitCode", u.status as "unitStatus", b.id as "buildingId", b.name as "buildingName"
      from units u join buildings b on b.id = u.building_id
      where true ${buildingFilter(input.buildingId, sql.raw("b.id"))}
      order by b.name, u.code`),
    query<{
      leaseId: string;
      leaseStatus: "active" | "notice";
      unitId: string;
      tenantId: string;
      tenantName: string;
      tenantPhone: string;
      balance: number;
      expected: number;
      collected: number;
      paidThisPeriod: number;
      oldestOpenDue: IsoDate | null;
    }>(sql`
      select l.id as "leaseId", l.status as "leaseStatus", l.unit_id as "unitId", t.id as "tenantId", t.full_name as "tenantName", t.phone as "tenantPhone",
        coalesce((select sum(le.debit - le.credit) from ledger_entries le where le.lease_id = l.id), 0)::int as balance,
        coalesce((select sum(il.amount - il.waived_amount) from invoice_lines il join invoices i on i.id = il.invoice_id
                  where i.lease_id = l.id and i.period = ${period}), 0)::int as expected,
        coalesce((select sum(${LINE_ALLOCATED}) from invoice_lines il join invoices i on i.id = il.invoice_id
                  where i.lease_id = l.id and i.period = ${period}), 0)::int as collected,
        coalesce((select sum(p.amount) from payments p where p.lease_id = l.id and p.match_status = 'matched'
                  and p.paid_at >= ${at(periodStart)} and p.paid_at < ${at(periodEnd)}), 0)::int as "paidThisPeriod",
        (select min(i.due_date)::text from invoices i where i.lease_id = l.id and exists (
           select 1 from invoice_lines il where il.invoice_id = i.id and ${LINE_OPEN} > 0)) as "oldestOpenDue"
      from leases l join tenants t on t.id = l.tenant_id where l.status in ('active', 'notice')`),
  ]);

  const leaseByUnit = new Map(leaseRows.map((lease) => [lease.unitId, lease]));
  const groups = new Map<string, { buildingId: string; buildingName: string; units: BoardUnit[] }>();
  for (const unit of unitRows) {
    const lease = leaseByUnit.get(unit.unitId);
    const graceDays = resolver(unit.buildingId, today).settings.graceDays;
    const row: BoardUnit = {
      unitId: unit.unitId,
      unitCode: unit.unitCode,
      unitStatus: unit.unitStatus,
      paymentStatus: unitPaymentStatus({
        hasCurrentLease: Boolean(lease),
        balance: lease?.balance ?? 0,
        paidThisPeriod: lease?.paidThisPeriod ?? 0,
        today,
        graceEndsOn: lease?.oldestOpenDue ? graceEndsOn(lease.oldestOpenDue, graceDays) : null,
      }),
      leaseId: lease?.leaseId ?? null,
      leaseStatus: lease?.leaseStatus ?? null,
      tenantId: lease?.tenantId ?? null,
      tenantName: lease?.tenantName ?? null,
      tenantPhone: lease?.tenantPhone ?? null,
      balance: lease?.balance ?? 0,
      expected: lease?.expected ?? 0,
      collected: lease?.collected ?? 0,
      oldestOpenDue: lease?.oldestOpenDue ?? null,
    };
    const group = groups.get(unit.buildingId) ?? { buildingId: unit.buildingId, buildingName: unit.buildingName, units: [] };
    group.units.push(row);
    groups.set(unit.buildingId, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    totals: {
      units: group.units.length,
      occupied: group.units.filter((unit) => unit.leaseId).length,
      notice: group.units.filter((unit) => unit.leaseStatus === "notice").length,
      expected: sumShillings(group.units.map((unit) => unit.expected)),
      collected: sumShillings(group.units.map((unit) => unit.collected)),
      arrears: sumShillings(group.units.map((unit) => Math.max(0, unit.balance))),
    },
  }));
}

export type AttentionItem =
  | { kind: "unmatched"; id: string; title: string; meta: string; href: string }
  | { kind: "claim"; id: string; title: string; meta: string; href: string }
  | { kind: "reading"; id: string; title: string; meta: string; href: string }
  | { kind: "overdue"; id: string; title: string; meta: string; href: string; leaseId: string; tenantName: string; unitCode: string; phone: string; amount: number; remindedToday: boolean };

const CHANNEL_LABELS: Record<string, string> = { stk: "STK push", paybill: "Paybill", bank: "Bank", cash: "Cash", cheque: "Cheque", opening: "Opening balance" };
const shortAmount = (amount: number) => `KES ${amount.toLocaleString("en-KE")}`;

/**
 * What needs the landlord, in order: unmatched payments, waiting claims, flagged readings, overdue leases (oldest first).
 * `total` counts every item; `items` holds the first `limit`.
 */
export async function attentionItems(
  input: { today?: IsoDate; limit?: number; board?: Awaited<ReturnType<typeof unitStatusBoard>> | ReturnType<typeof unitStatusBoard> } = {},
) {
  const today = input.today ?? todayInNairobi();
  const limit = input.limit ?? 5;
  const [board, unmatched, claims, readings, reminded] = await Promise.all([
    input.board ?? unitStatusBoard({ today }),
    query<{ id: string; amount: number; payerName: string | null; payerPhone: string | null; accountReference: string | null; channel: string; paidAt: Date }>(sql`
      select p.id, p.amount, p.payer_name as "payerName", p.payer_phone as "payerPhone", p.account_reference as "accountReference",
        p.channel, p.paid_at as "paidAt"
      from payments p where p.match_status = 'unmatched' order by p.paid_at asc`),
    query<{ id: string; amount: number; method: string; paidOn: IsoDate; tenantName: string; unitCode: string }>(sql`
      select c.id, c.amount, c.method, c.paid_on::text as "paidOn", t.full_name as "tenantName", u.code as "unitCode"
      from payment_claims c join leases l on l.id = c.lease_id join tenants t on t.id = l.tenant_id join units u on u.id = l.unit_id
      where c.status = 'waiting' order by c.created_at asc`),
    query<{ id: string; unitId: string; unitCode: string; buildingId: string; period: BillingPeriod; used: number }>(sql`
      select r.id, u.id as "unitId", u.code as "unitCode", u.building_id as "buildingId", r.period,
        (r.current_reading - r.previous_reading)::int as used
      from meter_readings r join units u on u.id = r.unit_id
      where r.flagged and not r.confirmed order by r.period asc, u.code asc`),
    // Leases the landlord already sent a reminder to today (real Nairobi day): "Send reminder" is once a day.
    query<{ leaseId: string }>(sql`
      select distinct m.lease_id as "leaseId" from messages m
      where m.template = 'reminder_manual' and m.status in ('sent', 'delivered', 'queued')
        and m.created_at >= ${startOfNairobiDay(todayInNairobi()).toISOString()}::timestamptz and m.lease_id is not null`),
  ]);
  const remindedToday = new Set(reminded.map((row) => row.leaseId));

  const overdue = board
    .flatMap((group) => group.units)
    .filter((unit) => unit.paymentStatus === "overdue" && unit.leaseId)
    .sort((a, b) => (a.oldestOpenDue ?? today).localeCompare(b.oldestOpenDue ?? today));

  const all: AttentionItem[] = [
    ...unmatched.map((payment) => ({
      kind: "unmatched" as const,
      id: payment.id,
      title: `${shortAmount(payment.amount)} unmatched`,
      meta: [payment.payerName ?? payment.payerPhone, `account “${payment.accountReference || "blank"}”`, formatNairobiDateTime(new Date(payment.paidAt))]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/payments?tab=unmatched&payment=${payment.id}`,
    })),
    ...claims.map((claim) => ({
      kind: "claim" as const,
      id: claim.id,
      title: `${claim.unitCode} reported ${shortAmount(claim.amount)}`,
      meta: `${claim.tenantName} · ${claim.method} · paid ${claim.paidOn}`,
      href: "/admin/payments?tab=claims",
    })),
    ...readings.map((reading) => ({
      kind: "reading" as const,
      id: reading.id,
      title: `${reading.unitCode} water reading flagged`,
      meta: `${reading.used} units used · ${reading.period}`,
      href: `/admin/meter-readings?building=${reading.buildingId}&period=${reading.period}&unit=${reading.unitId}`,
    })),
    ...overdue.map((unit) => ({
      kind: "overdue" as const,
      id: unit.leaseId as string,
      title: `${unit.unitCode} owes ${shortAmount(unit.balance)}`,
      meta: `${unit.tenantName ?? "Tenant"} · ${unit.oldestOpenDue ? `${daysBetween(unit.oldestOpenDue, today)} days overdue` : "overdue"}`,
      href: unit.tenantId ? `/admin/tenants/${unit.tenantId}` : `/admin/units/${unit.unitId}`,
      leaseId: unit.leaseId as string,
      tenantName: unit.tenantName ?? "Tenant",
      unitCode: unit.unitCode,
      phone: unit.tenantPhone ?? "",
      amount: Math.max(1, unit.balance),
      remindedToday: remindedToday.has(unit.leaseId as string),
    })),
  ];
  return {
    items: all.slice(0, limit),
    total: all.length,
    counts: { unmatched: unmatched.length, claims: claims.length, readings: readings.length, overdue: overdue.length },
  };
}

/**
 * Sidebar and top-bar data for every landlord page. Kept deliberately cheap (COUNT queries only) so
 * tab switches don't wait on unitStatusBoard (~seconds). Full attention items load when the bell opens.
 * Cached ~30s across navigations; invalidated when landlord actions revalidate the layout.
 */
export const adminShellSummary = cache(async () =>
  unstable_cache(
    async () => {
      const [buildingRows, countRows] = await Promise.all([
        query<{ id: string; name: string }>(sql`select id, name from buildings order by name`),
        query<{ unmatched: number; claims: number; readings: number }>(sql`
          select
            (select count(*)::int from payments where match_status = 'unmatched') as unmatched,
            (select count(*)::int from payment_claims where status = 'waiting') as claims,
            (select count(*)::int from meter_readings where flagged and not confirmed) as readings`),
      ]);
      const counts = countRows[0] ?? { unmatched: 0, claims: 0, readings: 0 };
      const paymentsBadge = counts.unmatched + counts.claims;
      return {
        buildings: buildingRows,
        paymentsBadge,
        readingsBadge: counts.readings,
        attention: {
          items: [] as Awaited<ReturnType<typeof attentionItems>>["items"],
          total: paymentsBadge + counts.readings,
          counts: { unmatched: counts.unmatched, claims: counts.claims, readings: counts.readings, overdue: 0 },
        },
      };
    },
    ["admin-shell-summary"],
    { revalidate: 30, tags: ["admin-shell"] },
  )(),
);

/** Expected (invoice totals for the period) and collected (matched payments posted in the month), for `months` months ending at `period`. */
export async function collectionTrend(input: { period: BillingPeriod; months?: number }) {
  const end = assertBillingPeriod(input.period);
  const months = input.months ?? 12;
  const first = addMonthsToPeriod(end, -(months - 1));
  const [rangeStart] = periodBounds(first);
  const [, rangeEnd] = periodBounds(end);
  const [expectedRows, collectedRows] = await Promise.all([
    query<{ period: BillingPeriod; amount: number }>(sql`
      select i.period, coalesce(sum(il.amount - il.waived_amount), 0)::int as amount
      from invoices i join invoice_lines il on il.invoice_id = i.id
      where i.period >= ${first} and i.period <= ${end} group by i.period`),
    query<{ period: BillingPeriod; amount: number }>(sql`
      select to_char(p.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM') as period, coalesce(sum(p.amount), 0)::int as amount
      from payments p
      where p.match_status = 'matched' and p.paid_at >= ${at(rangeStart)} and p.paid_at < ${at(rangeEnd)}
      group by 1`),
  ]);
  const expected = new Map(expectedRows.map((row) => [row.period, row.amount]));
  const collected = new Map(collectedRows.map((row) => [row.period, row.amount]));
  return Array.from({ length: months }, (_, index) => {
    const period = addMonthsToPeriod(first, index);
    return { period, collected: collected.get(period) ?? 0, expected: expected.get(period) ?? 0 };
  });
}

/**
 * The landlord dashboard for `period` (default: this month). Money figures are for the period; arrears, occupancy,
 * unit status and attention items are as of `today`.
 */
export async function dashboard(input: { period?: BillingPeriod; today?: IsoDate } = {}) {
  const today = input.today ?? todayInNairobi();
  const period = input.period ? assertBillingPeriod(input.period) : periodOf(today);

  // Everything starts at once: the attention list's own queries run while the unit board loads, and it uses
  // the same board (as a promise) instead of waiting for it before starting.
  const boardPromise = unitStatusBoard({ today, period });
  const [board, trend, latest, paidUnitsRows, attention] = await Promise.all([
    boardPromise,
    collectionTrend({ period }),
    query<{
      id: string;
      paidAt: Date;
      channel: string;
      amount: number;
      matchStatus: "matched" | "unmatched" | "reversed";
      mpesaReceipt: string | null;
      unitCode: string | null;
      tenantName: string | null;
      payerName: string | null;
      receiptNumber: string | null;
      receiptToken: string | null;
    }>(sql`
      select p.id, p.paid_at as "paidAt", p.channel, p.amount, p.match_status as "matchStatus", p.mpesa_receipt as "mpesaReceipt",
        u.code as "unitCode", t.full_name as "tenantName", p.payer_name as "payerName", r.number as "receiptNumber", r.token as "receiptToken"
      from payments p
      left join leases l on l.id = p.lease_id left join units u on u.id = l.unit_id left join tenants t on t.id = l.tenant_id
      left join receipts r on r.payment_id = p.id
      order by p.paid_at desc limit 10`),
    query<{ paid: number }>(sql`
      select count(*)::int as paid from (
        select i.lease_id from invoices i join invoice_lines il on il.invoice_id = i.id
        where i.period = ${period}
        group by i.lease_id
        having sum(il.amount - il.waived_amount) > 0 and sum(${LINE_OPEN}) <= 0) x`),
    attentionItems({ today, limit: 5, board: period === periodOf(today) ? boardPromise : undefined }),
  ]);

  const units = board.flatMap((group) => group.units);
  const occupied = units.filter((unit) => unit.leaseId).length;
  const notice = units.filter((unit) => unit.leaseStatus === "notice").length;
  const owing = units.filter((unit) => unit.leaseId && unit.balance > 0);
  const overdue = units.filter((unit) => unit.paymentStatus === "overdue");
  const oldestDue = owing.map((unit) => unit.oldestOpenDue).filter((due): due is IsoDate => Boolean(due) && (due as IsoDate) <= today).sort()[0];
  const current = trend[trend.length - 1] ?? { period, collected: 0, expected: 0 };

  return {
    today,
    period,
    collected: {
      amount: current.collected,
      percentOfExpected: current.expected > 0 ? Math.round((current.collected / current.expected) * 100) : null,
      expected: current.expected,
      paidUnits: paidUnitsRows[0]?.paid ?? 0,
      occupied,
    },
    expected: { amount: current.expected, occupied },
    arrears: {
      amount: sumShillings(owing.map((unit) => unit.balance)),
      overdue: overdue.length,
      owingUnits: owing.length,
      oldestDays: oldestDue ? daysBetween(oldestDue, today) : 0,
    },
    occupancy: {
      occupied,
      total: units.length,
      percent: units.length > 0 ? Math.round((occupied / units.length) * 100) : 0,
      vacant: units.length - occupied,
      notice,
    },
    trend,
    attention,
    latestPayments: latest.map(({ paidAt, channel, ...row }) => ({
      ...row,
      paidAt: formatNairobiDateTime(new Date(paidAt)),
      channel: CHANNEL_LABELS[channel] ?? channel,
      name: row.tenantName ?? row.payerName ?? "Unknown payer",
    })),
    buildings: board,
  };
}

// ---------------------------------------------------------------------------
// Table reports
// ---------------------------------------------------------------------------

export async function collectionSummary(input: { period: BillingPeriod; buildingId?: string | null; today?: IsoDate }) {
  const period = assertBillingPeriod(input.period);
  const today = input.today ?? todayInNairobi();
  const resolver = await loadPolicyResolver();
  const raw = await query<{
    buildingId: string;
    buildingName: string;
    unitCode: string;
    tenantName: string;
    invoiceNumber: string;
    dueDate: IsoDate;
    billed: number;
    paid: number;
    waived: number;
  }>(sql`
    select b.id as "buildingId", b.name as "buildingName", u.code as "unitCode", t.full_name as "tenantName",
      i.number as "invoiceNumber", i.due_date::text as "dueDate",
      sum(il.amount - il.waived_amount)::int as billed, sum(${LINE_ALLOCATED})::int as paid, sum(il.waived_amount)::int as waived
    from invoices i
    join invoice_lines il on il.invoice_id = i.id
    join leases l on l.id = i.lease_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
    join tenants t on t.id = l.tenant_id
    where i.period = ${period} ${buildingFilter(input.buildingId, sql.raw("b.id"))}
    group by b.id, b.name, u.code, t.full_name, i.number, i.due_date
    order by b.name, u.code`);
  const rows = raw.map(({ buildingId, ...row }) => {
    const open = Math.max(0, row.billed - row.paid);
    const graceEnd = graceEndsOn(row.dueDate, resolver(buildingId, today).settings.graceDays);
    const status = open === 0 ? "paid" : today > graceEnd ? "overdue" : row.paid > 0 ? "partial" : "unpaid";
    return { ...row, open, status };
  });
  const billed = sumShillings(rows.map((row) => row.billed));
  const paid = sumShillings(rows.map((row) => row.paid));
  return { period, rows, totals: { invoices: rows.length, billed, paid, open: sumShillings(rows.map((row) => row.open)), collectionRate: percent(paid, billed) } };
}

export async function arrearsAging(input: { today?: IsoDate; buildingId?: string | null } = {}) {
  const today = input.today ?? todayInNairobi();
  const raw = await query<{ unitCode: string; buildingName: string; tenantName: string; leaseStatus: string; dueDate: IsoDate; open: number }>(sql`
    select u.code as "unitCode", b.name as "buildingName", t.full_name as "tenantName", l.status as "leaseStatus",
      i.due_date::text as "dueDate", ${LINE_OPEN}::int as open
    from invoice_lines il
    join invoices i on i.id = il.invoice_id
    join leases l on l.id = i.lease_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
    join tenants t on t.id = l.tenant_id
    where ${LINE_OPEN} > 0 ${buildingFilter(input.buildingId, sql.raw("b.id"))}
    order by b.name, u.code`);

  type Row = { unitCode: string; buildingName: string; tenantName: string; leaseStatus: string; current: number; days1To30: number; days31To60: number; days61To90: number; over90: number; total: number };
  const byLease = new Map<string, Row>();
  for (const line of raw) {
    const key = `${line.unitCode}:${line.tenantName}:${line.leaseStatus}`;
    const row = byLease.get(key) ?? { unitCode: line.unitCode, buildingName: line.buildingName, tenantName: line.tenantName, leaseStatus: line.leaseStatus, current: 0, days1To30: 0, days31To60: 0, days61To90: 0, over90: 0, total: 0 };
    const late = daysBetween(line.dueDate, today);
    const bucket: keyof Row = late <= 0 ? "current" : late <= 30 ? "days1To30" : late <= 60 ? "days31To60" : late <= 90 ? "days61To90" : "over90";
    (row[bucket] as number) += line.open;
    row.total += line.open;
    byLease.set(key, row);
  }
  const rows = [...byLease.values()];
  const total = (key: "current" | "days1To30" | "days31To60" | "days61To90" | "over90" | "total") => sumShillings(rows.map((row) => row[key]));
  return {
    today,
    rows,
    totals: { current: total("current"), days1To30: total("days1To30"), days31To60: total("days31To60"), days61To90: total("days61To90"), over90: total("over90"), total: total("total") },
  };
}

/** Occupancy per unit between `from` and `to` (default: this month to date), with vacant days and rent lost. */
export async function occupancy(input: { today?: IsoDate; from?: IsoDate; to?: IsoDate } = {}) {
  const today = input.today ?? todayInNairobi();
  const from = input.from ? assertIsoDate(input.from) : firstDayOfPeriod(periodOf(today));
  const to = input.to ? assertIsoDate(input.to) : today;
  const days = daysBetween(from, to) + 1;
  if (days <= 0) throw new Error("from must be on or before to");

  const [unitRows, leaseRows] = await Promise.all([
    query<{ unitId: string; unitCode: string; buildingName: string; unitStatus: string; rentAmount: number }>(sql`
      select u.id as "unitId", u.code as "unitCode", b.name as "buildingName", u.status as "unitStatus", u.rent_amount as "rentAmount"
      from units u join buildings b on b.id = u.building_id order by b.name, u.code`),
    query<{ unitId: string; startDate: IsoDate; endDate: IsoDate | null; status: string; tenantName: string }>(sql`
      select l.unit_id as "unitId", l.start_date::text as "startDate", l.end_date::text as "endDate", l.status, t.full_name as "tenantName"
      from leases l join tenants t on t.id = l.tenant_id
      where l.start_date <= ${to} and (l.end_date is null or l.end_date >= ${from})`),
  ]);

  const rows = unitRows.map((unit) => {
    const covered = new Set<IsoDate>();
    for (const lease of leaseRows.filter((item) => item.unitId === unit.unitId)) {
      const start = laterDate(lease.startDate, from);
      const end = earlierDate(lease.endDate ?? to, to);
      for (let day = start; day <= end; day = addDays(day, 1)) covered.add(day);
    }
    const current = leaseRows.find((lease) => lease.unitId === unit.unitId && lease.status !== "ended");
    const vacantDays = days - covered.size;
    return {
      unitCode: unit.unitCode,
      buildingName: unit.buildingName,
      unitStatus: unit.unitStatus,
      currentTenant: current?.tenantName ?? null,
      occupiedDays: covered.size,
      vacantDays,
      rentLost: Math.round((unit.rentAmount * 12 * vacantDays) / 365),
    };
  });
  const occupiedNow = rows.filter((row) => row.currentTenant).length;
  return {
    from,
    to,
    rows,
    totals: {
      units: rows.length,
      occupiedNow,
      occupancyRate: percent(occupiedNow, rows.length),
      vacantDays: rows.reduce((sum, row) => sum + row.vacantDays, 0),
      rentLost: sumShillings(rows.map((row) => row.rentLost)),
    },
  };
}

function monthsBetween(from: IsoDate, to: IsoDate): BillingPeriod[] {
  const months: BillingPeriod[] = [];
  for (let period = periodOf(from); period <= periodOf(to); period = addMonthsToPeriod(period, 1)) months.push(period);
  return months;
}

export async function incomeAndExpenses(input: { from: IsoDate; to: IsoDate; buildingId?: string | null }) {
  const from = assertIsoDate(input.from);
  const to = assertIsoDate(input.to);
  const start = startOfNairobiDay(from);
  const end = startOfNairobiDay(addDays(to, 1));
  const incomeBuilding = input.buildingId ? sql`and u.building_id = ${input.buildingId}` : sql``;
  const [income, spending] = await Promise.all([
    query<{ month: string; amount: number }>(sql`
      select to_char(p.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM') as month, sum(p.amount)::int as amount
      from payments p left join leases l on l.id = p.lease_id left join units u on u.id = l.unit_id
      where p.match_status <> 'reversed' and p.paid_at >= ${at(start)} and p.paid_at < ${at(end)} ${incomeBuilding}
      group by 1`),
    query<{ month: string; amount: number }>(sql`
      select to_char(e.spent_on, 'YYYY-MM') as month, sum(e.amount)::int as amount
      from expenses e where e.spent_on between ${from} and ${to} ${buildingFilter(input.buildingId, sql.raw("e.building_id"))}
      group by 1`),
  ]);
  const rows = monthsBetween(from, to).map((month) => {
    const received = income.find((row) => row.month === month)?.amount ?? 0;
    const spent = spending.find((row) => row.month === month)?.amount ?? 0;
    return { month, income: received, expenses: spent, net: received - spent };
  });
  return {
    from,
    to,
    rows,
    totals: {
      income: sumShillings(rows.map((row) => row.income)),
      expenses: sumShillings(rows.map((row) => row.expenses)),
      net: sumShillings(rows.map((row) => row.net)),
    },
  };
}

/** Gross rent received per month for a year (payments minus the part that went to deposits), with an MRI estimate. */
export async function rentalIncomeForTax(input: { year: number }) {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error("year must be like 2026");
  const from = `${input.year}-01-01`;
  const to = `${input.year}-12-31`;
  const raw = await query<{ month: string; received: number; deposits: number }>(sql`
    select to_char(p.paid_at at time zone 'Africa/Nairobi', 'YYYY-MM') as month,
      sum(p.amount)::int as received,
      coalesce(sum((select sum(a.amount) from allocations a join invoice_lines il on il.id = a.invoice_line_id
                    where a.payment_id = p.id and il.type = 'deposit')), 0)::int as deposits
    from payments p
    where p.match_status = 'matched' and p.paid_at >= ${at(startOfNairobiDay(from))} and p.paid_at < ${at(startOfNairobiDay(`${input.year + 1}-01-01`))}
    group by 1`);
  const rows = monthsBetween(from, to).map((month) => {
    const row = raw.find((item) => item.month === month);
    const received = row?.received ?? 0;
    const deposits = row?.deposits ?? 0;
    const grossRent = received - deposits;
    return { month, received, deposits, grossRent, estimatedTax: Math.round((grossRent * RENTAL_INCOME_TAX_PERCENT) / 100) };
  });
  return {
    year: input.year,
    taxRatePercent: RENTAL_INCOME_TAX_PERCENT,
    rows,
    totals: {
      received: sumShillings(rows.map((row) => row.received)),
      deposits: sumShillings(rows.map((row) => row.deposits)),
      grossRent: sumShillings(rows.map((row) => row.grossRent)),
      estimatedTax: sumShillings(rows.map((row) => row.estimatedTax)),
    },
  };
}

async function paymentLogRows(where: SQL, limit = 5000) {
  const raw = await query<{
    paidAt: Date;
    channel: string;
    mpesaReceipt: string | null;
    amount: number;
    unitCode: string | null;
    tenantName: string | null;
    payerName: string | null;
    payerPhone: string | null;
    accountReference: string | null;
    matchStatus: string;
    receiptNumber: string | null;
    receiptVoided: boolean;
  }>(sql`
    select p.paid_at as "paidAt", p.channel, p.mpesa_receipt as "mpesaReceipt", p.amount, u.code as "unitCode",
      t.full_name as "tenantName", p.payer_name as "payerName", p.payer_phone as "payerPhone",
      p.account_reference as "accountReference", p.match_status as "matchStatus",
      r.number as "receiptNumber", (r.voided_at is not null) as "receiptVoided"
    from payments p
    left join leases l on l.id = p.lease_id left join units u on u.id = l.unit_id left join tenants t on t.id = l.tenant_id
    left join receipts r on r.payment_id = p.id
    where ${where}
    order by p.paid_at desc
    limit ${limit}`);
  return raw.map(({ paidAt, ...row }) => ({ paidAt: formatNairobiDateTime(new Date(paidAt)), ...row }));
}

export async function paymentLog(input: { from: IsoDate; to: IsoDate }) {
  const from = assertIsoDate(input.from);
  const to = assertIsoDate(input.to);
  const rows = await paymentLogRows(sql`p.paid_at >= ${at(startOfNairobiDay(from))} and p.paid_at < ${at(startOfNairobiDay(addDays(to, 1)))}`);
  const counted = rows.filter((row) => row.matchStatus !== "reversed");
  return { from, to, rows, totals: { payments: counted.length, amount: sumShillings(counted.map((row) => row.amount)), reversed: rows.length - counted.length } };
}

/** Deposits charged, held, applied at move-out and refunded, per lease. */
export async function depositRegister() {
  const raw = await query<{
    unitCode: string;
    tenantName: string;
    leaseStatus: string;
    moveOutDate: string | null;
    charged: number;
    allocated: number;
    applied: number;
    refundDue: number;
    refunded: number;
    refundedOn: string | null;
  }>(sql`
    select u.code as "unitCode", t.full_name as "tenantName", l.status as "leaseStatus", l.move_out_date::text as "moveOutDate",
      coalesce((select sum(il.amount) from invoice_lines il join invoices i on i.id = il.invoice_id where i.lease_id = l.id and il.type = 'deposit'), 0)::int as charged,
      coalesce((select sum(a.amount) from allocations a join invoice_lines il on il.id = a.invoice_line_id join invoices i on i.id = il.invoice_id
                where i.lease_id = l.id and il.type = 'deposit'), 0)::int as allocated,
      coalesce((select sum(le.credit) from ledger_entries le where le.lease_id = l.id and le.type = 'adjustment' and le.reference = 'Deposit applied'), 0)::int as applied,
      l.deposit_refund_due as "refundDue", l.deposit_refunded_amount as refunded, l.deposit_refunded_on::text as "refundedOn"
    from leases l join units u on u.id = l.unit_id join tenants t on t.id = l.tenant_id
    order by l.status, u.code`);
  const rows = raw.map(({ allocated, ...row }) => ({
    ...row,
    held: Math.max(0, allocated - row.refunded),
    stillToRefund: row.leaseStatus === "ended" ? Math.max(0, row.refundDue - row.refunded) : 0,
  }));
  return {
    rows,
    totals: {
      charged: sumShillings(rows.map((row) => row.charged)),
      held: sumShillings(rows.map((row) => row.held)),
      applied: sumShillings(rows.map((row) => row.applied)),
      refunded: sumShillings(rows.map((row) => row.refunded)),
      stillToRefund: sumShillings(rows.map((row) => row.stillToRefund)),
    },
  };
}

export const REPORT_NAMES = [
  "collection-summary",
  "arrears-aging",
  "occupancy",
  "income-and-expenses",
  "rental-income-for-tax",
  "payment-log",
  "deposit-register",
] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

export type ReportResult = { rows: Record<string, unknown>[]; totals?: Record<string, unknown> } & Record<string, unknown>;

/** Runs a table report by name with string parameters (from a URL): the screens, CSV export and sandbox share this. */
export async function runReport(name: ReportName, parameters: Record<string, string | undefined>): Promise<ReportResult> {
  const today = parameters.date && /^\d{4}-\d{2}-\d{2}$/.test(parameters.date) ? parameters.date : todayInNairobi();
  const buildingId = parameters.buildingId || null;
  const thisMonthStart = firstDayOfPeriod(periodOf(today));
  const from = parameters.from || thisMonthStart;
  const to = parameters.to || today;
  switch (name) {
    case "collection-summary":
      return collectionSummary({ period: parameters.period || periodOf(today), buildingId, today });
    case "arrears-aging":
      return arrearsAging({ today, buildingId });
    case "occupancy":
      return occupancy({ today, from, to });
    case "income-and-expenses":
      return incomeAndExpenses({ from: parameters.from || `${today.slice(0, 4)}-01-01`, to, buildingId });
    case "rental-income-for-tax":
      return rentalIncomeForTax({ year: Number(parameters.year || today.slice(0, 4)) });
    case "payment-log":
      return paymentLog({ from, to });
    case "deposit-register":
      return depositRegister();
  }
}
