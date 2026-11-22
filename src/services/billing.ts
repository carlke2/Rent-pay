import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  assessReading,
  buildInvoiceLines,
  decidePenalty,
  dueDateFor,
  graceEndsOn,
  invoiceTotal,
  waterCharge,
  type InvoiceLineDraft,
  type PenaltyDecision,
  type ReadingFlag,
} from "@/core/billing";
import { allocatePayment, chargeEntries, accountForLine, type OpenInvoiceLine } from "@/core/ledger";
import type { InvoiceLineType, PolicySettings } from "@/core/policy";
import { getDatabase, type Executor, type Transaction } from "@/database/client";
import {
  allocations,
  auditLog,
  invoiceLines,
  invoices,
  ledgerEntries,
  leases,
  meterReadings,
  payments,
  rentChanges,
  units,
} from "@/database/schema";
import {
  addMonthsToPeriod,
  assertBillingPeriod,
  assertIsoDate,
  firstDayOfPeriod,
  lastDayOfPeriod,
  periodOf,
  todayInNairobi,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";
import { assertShillings, sumShillings, type Shillings } from "@/utilities/money";
import { assertPeriodOpen } from "./closed-periods";
import { ServiceError } from "./errors";
import { queueJob } from "./jobs";
import { getPolicy, loadPolicyResolver } from "./policies";

/** A problem with the request (bad input, wrong state), safe to show to the caller. */
export class BillingError extends ServiceError {}

// ---------------------------------------------------------------------------
// Open amounts: amount − allocations − waived_amount, everywhere.
// ---------------------------------------------------------------------------

// Correlated subqueries name the outer table explicitly: Drizzle leaves columns unqualified in
// single-table selects, and an unqualified "id" inside the subquery would mean allocations.id.
const lineAllocated = sql<number>`(select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = "invoice_lines"."id")::int`;
const paymentAllocated = sql<number>`(select coalesce(sum(a.amount), 0) from allocations a where a.payment_id = "payments"."id")::int`;

type LineWithOpen = OpenInvoiceLine & { leaseId: string; amount: Shillings; allocated: Shillings; waived: Shillings };

/** Every invoice line for the given leases with its open amount (including fully paid ones). */
async function loadLines(database: Executor, leaseIds: readonly string[]): Promise<LineWithOpen[]> {
  if (leaseIds.length === 0) return [];
  const rows = await database
    .select({
      leaseId: invoices.leaseId,
      invoiceLineId: invoiceLines.id,
      invoiceId: invoices.id,
      period: invoices.period,
      dueDate: invoices.dueDate,
      invoiceNumber: invoices.number,
      type: invoiceLines.type,
      amount: invoiceLines.amount,
      waived: invoiceLines.waivedAmount,
      allocated: lineAllocated,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(inArray(invoices.leaseId, [...leaseIds]))
    .orderBy(asc(invoices.period), asc(invoices.dueDate), asc(invoiceLines.createdAt));
  return rows.map((row) => ({ ...row, outstanding: Math.max(0, row.amount - row.allocated - row.waived) }));
}

/** Locks a lease row for the rest of the transaction and returns its building. */
async function lockLease(transaction: Transaction, leaseId: string) {
  const [lease] = await transaction
    .select({ id: leases.id, buildingId: units.buildingId, unitCode: units.code })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId))
    .for("update", { of: leases });
  if (!lease) throw new BillingError(`Lease ${leaseId} not found`);
  return lease;
}

// ---------------------------------------------------------------------------
// Credit: the single allocation path
// ---------------------------------------------------------------------------

/**
 * Allocates the unallocated part of this lease's payments (oldest first) to its open invoice lines,
 * oldest invoice first and then by the policy's allocation order. No ledger entry is written:
 * the money was already credited when the payment was recorded.
 */
export async function applyCredit(
  leaseId: string,
  transaction: Transaction,
  today: IsoDate = todayInNairobi(),
): Promise<{ allocated: Shillings }> {
  const lease = await lockLease(transaction, leaseId);

  const paymentRows = await transaction
    .select({ id: payments.id, amount: payments.amount, allocated: paymentAllocated })
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), eq(payments.matchStatus, "matched")))
    .orderBy(asc(payments.paidAt), asc(payments.createdAt));
  const withCredit = paymentRows.filter((payment) => payment.amount > payment.allocated);
  if (withCredit.length === 0) return { allocated: 0 };

  let openLines = (await loadLines(transaction, [leaseId])).filter((line) => line.outstanding > 0);
  if (openLines.length === 0) return { allocated: 0 };

  const { settings } = await getPolicy(lease.buildingId, today, transaction);
  let total = 0;

  for (const payment of withCredit) {
    const result = allocatePayment({
      amount: payment.amount - payment.allocated,
      openLines,
      allocationOrder: settings.allocationOrder,
    });
    if (result.allocations.length === 0) continue;

    await transaction.insert(allocations).values(result.allocations.map((item) => ({ paymentId: payment.id, ...item })));
    total += result.allocated;

    const used = new Map(result.allocations.map((item) => [item.invoiceLineId, item.amount]));
    openLines = openLines
      .map((line) => ({ ...line, outstanding: line.outstanding - (used.get(line.invoiceLineId) ?? 0) }))
      .filter((line) => line.outstanding > 0);
    if (openLines.length === 0) break;
  }
  return { allocated: total };
}

// ---------------------------------------------------------------------------
// Meter readings
// ---------------------------------------------------------------------------

const FLAG_REASONS: Record<ReadingFlag, string> = {
  lower_than_previous: "Lower than the previous reading",
  unusually_high: "More than 3× the 3-month average consumption",
};

/**
 * The unit's last confirmed reading on or before a date (any kind: regular, opening at move-in, final at
 * move-out), plus up to 3 recent consumptions. `excludeId` / `replacingPeriod` leave out the reading being saved.
 */
export async function readingHistory(
  database: Executor,
  unitId: string,
  onOrBefore: IsoDate,
  exclude: { readingId?: string; replacingPeriod?: BillingPeriod } = {},
) {
  const conditions = [eq(meterReadings.unitId, unitId), eq(meterReadings.confirmed, true), lte(meterReadings.readOn, onOrBefore)];
  if (exclude.readingId) conditions.push(ne(meterReadings.id, exclude.readingId));
  if (exclude.replacingPeriod) {
    conditions.push(sql`not (${meterReadings.period} = ${exclude.replacingPeriod} and ${meterReadings.kind} = 'regular')`);
  }
  const earlier = await database
    .select({ previousReading: meterReadings.previousReading, currentReading: meterReadings.currentReading, kind: meterReadings.kind })
    .from(meterReadings)
    .where(and(...conditions))
    .orderBy(desc(meterReadings.readOn), desc(meterReadings.createdAt))
    .limit(6);
  return summariseHistory(earlier);
}

/**
 * readingHistory for many units in one query (the reading sheet), replacing `replacingPeriod`'s regular reading.
 * Returns a map from unit ID to the same shape readingHistory returns.
 */
export async function readingHistories(
  database: Executor,
  unitIds: readonly string[],
  onOrBefore: IsoDate,
  replacingPeriod: BillingPeriod,
): Promise<Map<string, ReturnType<typeof summariseHistory>>> {
  const result = new Map<string, ReturnType<typeof summariseHistory>>();
  if (!unitIds.length) return result;
  const ranked = database
    .select({
      unitId: meterReadings.unitId,
      previousReading: meterReadings.previousReading,
      currentReading: meterReadings.currentReading,
      kind: meterReadings.kind,
      rank: sql<number>`row_number() over (partition by ${meterReadings.unitId} order by ${meterReadings.readOn} desc, ${meterReadings.createdAt} desc)`.as("rank"),
    })
    .from(meterReadings)
    .where(
      and(
        inArray(meterReadings.unitId, [...unitIds]),
        eq(meterReadings.confirmed, true),
        lte(meterReadings.readOn, onOrBefore),
        sql`not (${meterReadings.period} = ${replacingPeriod} and ${meterReadings.kind} = 'regular')`,
      ),
    )
    .as("ranked");
  const rows = await database.select().from(ranked).where(lte(ranked.rank, 6)).orderBy(ranked.unitId, ranked.rank);
  const byUnit = new Map<string, typeof rows>();
  for (const row of rows) byUnit.set(row.unitId, [...(byUnit.get(row.unitId) ?? []), row]);
  for (const unitId of unitIds) result.set(unitId, summariseHistory(byUnit.get(unitId) ?? []));
  return result;
}

/** Newest-first confirmed readings → previous reading and up to 3 recent positive consumptions. */
function summariseHistory(earlier: readonly { previousReading: number; currentReading: number; kind: string }[]) {
  return {
    previousReading: earlier[0]?.currentReading ?? null,
    recentConsumptions: earlier
      .filter((reading) => reading.kind !== "opening")
      .map((reading) => reading.currentReading - reading.previousReading)
      .filter((consumption) => consumption > 0)
      .slice(0, 3),
  };
}

function describeAssessment(flags: readonly ReadingFlag[]): string | null {
  return flags.length ? flags.map((flag) => FLAG_REASONS[flag]).join("; ") : null;
}

/**
 * Saves readings for a period. previous_reading = the unit's last confirmed reading.
 * Flagged readings (lower than before, or > 3× the 3-month average) are saved unconfirmed.
 */
export async function saveMeterReadings(input: {
  period: BillingPeriod;
  readings: readonly { unitId: string; currentReading: number }[];
  actor: string;
  today?: IsoDate;
}) {
  const period = assertBillingPeriod(input.period);
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  const resolver = await loadPolicyResolver(database);

  const unitIds = [...new Set(input.readings.map((reading) => reading.unitId))];
  if (unitIds.length !== input.readings.length) throw new BillingError("Each unit can appear only once");
  const unitRows = unitIds.length
    ? await database
        .select({ id: units.id, code: units.code, buildingId: units.buildingId })
        .from(units)
        .where(inArray(units.id, unitIds))
    : [];
  const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));

  const results = [];
  for (const reading of input.readings) {
    const unit = unitById.get(reading.unitId);
    if (!unit) throw new BillingError(`Unit ${reading.unitId} not found`);
    if (!Number.isSafeInteger(reading.currentReading) || reading.currentReading < 0) {
      throw new BillingError(`Reading for ${unit.code} must be a whole number of at least 0`);
    }

    const history = await readingHistory(database, unit.id, today, { replacingPeriod: period });
    // With no earlier reading, this one becomes the baseline (no consumption).
    const previousReading = history.previousReading ?? reading.currentReading;
    const assessment = assessReading({
      previousReading,
      currentReading: reading.currentReading,
      recentConsumptions: history.recentConsumptions,
    });
    const settings = resolver(unit.buildingId, today).settings;
    const charge = waterCharge({ consumption: assessment.consumption, ...settings.water });

    const values = {
      unitId: unit.id,
      period,
      kind: "regular" as const,
      previousReading,
      currentReading: reading.currentReading,
      readOn: today,
      flagged: assessment.flagged,
      confirmed: !assessment.flagged,
    };
    const [saved] = await database
      .insert(meterReadings)
      .values(values)
      .onConflictDoUpdate({ target: [meterReadings.unitId, meterReadings.period, meterReadings.kind], set: values })
      .returning({ id: meterReadings.id });

    results.push({
      readingId: saved?.id ?? null,
      unitCode: unit.code,
      period,
      previousReading,
      currentReading: reading.currentReading,
      consumption: assessment.consumption,
      amount: charge.total,
      flagged: assessment.flagged,
      confirmed: !assessment.flagged,
      flagReason: describeAssessment(assessment.flags) ?? (history.previousReading === null ? "First reading (baseline)" : null),
    });
  }

  await database.insert(auditLog).values({
    actor: input.actor,
    action: "meter_readings.save",
    entity: "meter_readings",
    entityId: period,
    after: results,
  });
  return results;
}

async function findReading(database: Executor, readingId: string) {
  const [reading] = await database.select().from(meterReadings).where(eq(meterReadings.id, readingId)).limit(1);
  if (!reading) throw new BillingError("Meter reading not found");
  return reading;
}

export async function confirmMeterReading(input: { readingId: string; actor: string }) {
  const database = getDatabase();
  const before = await findReading(database, input.readingId);
  const [after] = await database
    .update(meterReadings)
    .set({ confirmed: true })
    .where(eq(meterReadings.id, input.readingId))
    .returning();
  await database.insert(auditLog).values({
    actor: input.actor,
    action: "meter_reading.confirm",
    entity: "meter_reading",
    entityId: input.readingId,
    before,
    after,
  });
  return after;
}

/** Replaces a reading's value and re-checks it; a correction that is still flagged stays unconfirmed. */
export async function correctMeterReading(input: { readingId: string; currentReading: number; actor: string }) {
  if (!Number.isSafeInteger(input.currentReading) || input.currentReading < 0) {
    throw new BillingError("Reading must be a whole number of at least 0");
  }
  const database = getDatabase();
  const before = await findReading(database, input.readingId);
  const history = await readingHistory(database, before.unitId, before.readOn, { readingId: before.id });
  const assessment = assessReading({
    previousReading: before.previousReading,
    currentReading: input.currentReading,
    recentConsumptions: history.recentConsumptions,
  });
  const [after] = await database
    .update(meterReadings)
    .set({ currentReading: input.currentReading, flagged: assessment.flagged, confirmed: !assessment.flagged })
    .where(eq(meterReadings.id, input.readingId))
    .returning();
  await database.insert(auditLog).values({
    actor: input.actor,
    action: "meter_reading.correct",
    entity: "meter_reading",
    entityId: input.readingId,
    before,
    after,
  });
  return { ...after, consumption: assessment.consumption, flagReason: describeAssessment(assessment.flags) };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** INV-YYYYMM-0001, numbered per period. Call inside the invoice's transaction. */
async function nextInvoiceNumber(transaction: Transaction, period: BillingPeriod): Promise<string> {
  const compact = period.replace("-", "");
  // Serialises numbering for this period until the transaction ends.
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice-number:${period}`}))`);
  const [row] = await transaction
    .select({ last: sql<number>`coalesce(max(split_part(${invoices.number}, '-', 3)::int), 0)::int` })
    .from(invoices)
    .where(and(eq(invoices.period, period), sql`${invoices.number} like ${`INV-${compact}-%`}`));
  return `INV-${compact}-${String((row?.last ?? 0) + 1).padStart(4, "0")}`;
}

/**
 * Inserts an invoice with its lines and one ledger charge per line, then applies any credit.
 * Call inside a transaction. Returns null if the lease already has an invoice for the period.
 */
export async function createInvoice(
  transaction: Transaction,
  input: { leaseId: string; period: BillingPeriod; lines: readonly InvoiceLineDraft[]; today: IsoDate; dueDate: IsoDate },
): Promise<{ id: string; number: string } | null> {
  const number = await nextInvoiceNumber(transaction, input.period);
  const [invoice] = await transaction
    .insert(invoices)
    .values({
      leaseId: input.leaseId,
      period: input.period,
      number,
      issueDate: input.today,
      dueDate: input.dueDate,
      total: invoiceTotal(input.lines),
    })
    .onConflictDoNothing({ target: [invoices.leaseId, invoices.period, invoices.source] })
    .returning({ id: invoices.id });
  if (!invoice) return null;
  await addInvoiceLines(transaction, { invoiceId: invoice.id, invoiceNumber: number, leaseId: input.leaseId, lines: input.lines, today: input.today });
  return { id: invoice.id, number };
}

/** Adds lines (and their ledger charges) to an existing invoice, keeps its total in step, then applies credit. */
export async function addInvoiceLines(
  transaction: Transaction,
  input: { invoiceId: string; invoiceNumber: string; leaseId: string; lines: readonly InvoiceLineDraft[]; today: IsoDate },
): Promise<{ id: string; type: InvoiceLineType; amount: Shillings }[]> {
  if (input.lines.length === 0) return [];
  const inserted = await transaction
    .insert(invoiceLines)
    .values(input.lines.map((line) => ({ invoiceId: input.invoiceId, ...line })))
    .returning({ id: invoiceLines.id, type: invoiceLines.type, amount: invoiceLines.amount });
  await transaction
    .update(invoices)
    .set({ total: sql`(select coalesce(sum(il.amount), 0) from invoice_lines il where il.invoice_id = ${input.invoiceId})` })
    .where(eq(invoices.id, input.invoiceId));
  const entries = chargeEntries({ leaseId: input.leaseId, entryDate: input.today, invoiceNumber: input.invoiceNumber, lines: inserted });
  if (entries.length) await transaction.insert(ledgerEntries).values(entries);
  await applyCredit(input.leaseId, transaction, input.today);
  return inserted;
}

/** Rent on a date: the latest rent change effective on or before it, otherwise the lease's rent. */
export async function loadRentResolver(
  database: Executor,
  leaseIds: readonly string[],
): Promise<(leaseId: string, onDate: IsoDate, leaseRent: Shillings) => Shillings> {
  const changes = leaseIds.length
    ? await database
        .select({ leaseId: rentChanges.leaseId, amount: rentChanges.amount, effectiveFrom: rentChanges.effectiveFrom })
        .from(rentChanges)
        .where(inArray(rentChanges.leaseId, [...leaseIds]))
        .orderBy(asc(rentChanges.effectiveFrom), asc(rentChanges.createdAt))
    : [];
  return (leaseId, onDate, leaseRent) => {
    let rent = leaseRent;
    for (const change of changes) if (change.leaseId === leaseId && change.effectiveFrom <= onDate) rent = change.amount;
    return rent;
  };
}

export type GenerateInvoicesResult = {
  period: BillingPeriod;
  dryRun: boolean;
  created: number;
  skipped: number;
  missingReadings: string[];
  flaggedReadings: string[];
  totalBilled: Shillings;
  invoices: { unitCode: string; number: string | null; dueDate: IsoDate; total: Shillings; lines: InvoiceLineDraft[] }[];
};

/**
 * Bills every lease that is active or on notice during the period. Idempotent: a lease that already
 * has an invoice for the period is skipped. One transaction per invoice (invoice, lines, ledger charges,
 * then credit applied). Invoice SMS are queued after each commit.
 */
export async function generateInvoices(input: {
  period: BillingPeriod;
  today?: IsoDate;
  dryRun?: boolean;
}): Promise<GenerateInvoicesResult> {
  const period = assertBillingPeriod(input.period);
  const today = input.today ?? todayInNairobi();
  const dryRun = input.dryRun ?? false;
  const periodStart = firstDayOfPeriod(period);
  const periodEnd = lastDayOfPeriod(period);
  const readingPeriod = addMonthsToPeriod(period, -1);
  const database = getDatabase();
  const [resolver] = await Promise.all([loadPolicyResolver(database), assertPeriodOpen(period, database)]);

  const leaseRows = await database
    .select({
      leaseId: leases.id,
      startDate: leases.startDate,
      endDate: leases.endDate,
      rentAmount: leases.rentAmount,
      depositAmount: leases.depositAmount,
      unitId: units.id,
      unitCode: units.code,
      buildingId: units.buildingId,
      meterNumber: units.meterNumber,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(
      and(
        lte(leases.startDate, periodEnd),
        or(inArray(leases.status, ["active", "notice"]), and(isNotNull(leases.endDate), gte(leases.endDate, periodStart))),
      ),
    )
    .orderBy(asc(units.code));

  const leaseIds = leaseRows.map((lease) => lease.leaseId);
  const unitIds = leaseRows.map((lease) => lease.unitId);
  const [existing, readings] = await Promise.all([
    leaseIds.length
      ? database
          .select({ leaseId: invoices.leaseId })
          .from(invoices)
          .where(and(eq(invoices.period, period), inArray(invoices.leaseId, leaseIds)))
      : [],
    unitIds.length
      ? database
          .select({
            unitId: meterReadings.unitId,
            previousReading: meterReadings.previousReading,
            currentReading: meterReadings.currentReading,
            confirmed: meterReadings.confirmed,
          })
          .from(meterReadings)
          .where(
            and(eq(meterReadings.period, readingPeriod), eq(meterReadings.kind, "regular"), inArray(meterReadings.unitId, unitIds)),
          )
      : [],
  ]);
  const rentFor = await loadRentResolver(database, leaseIds);
  const invoiced = new Set(existing.map((row) => row.leaseId));
  const readingByUnit = new Map(readings.map((reading) => [reading.unitId, reading]));

  const result: GenerateInvoicesResult = {
    period,
    dryRun,
    created: 0,
    skipped: 0,
    missingReadings: [],
    flaggedReadings: [],
    totalBilled: 0,
    invoices: [],
  };

  for (const lease of leaseRows) {
    if (invoiced.has(lease.leaseId)) {
      result.skipped += 1;
      continue;
    }

    // Rules in force on the first day of the period apply to that period's invoice.
    const settings = resolver(lease.buildingId, periodStart).settings;

    let waterConsumption: number | null = null;
    if (lease.meterNumber) {
      const reading = readingByUnit.get(lease.unitId);
      if (!reading) result.missingReadings.push(lease.unitCode);
      else if (!reading.confirmed) result.flaggedReadings.push(lease.unitCode);
      else waterConsumption = Math.max(0, reading.currentReading - reading.previousReading);
    }

    const lines = buildInvoiceLines({
      period,
      lease: {
        startDate: lease.startDate,
        endDate: lease.endDate,
        rentAmount: rentFor(lease.leaseId, periodStart, lease.rentAmount),
        depositAmount: lease.depositAmount,
      },
      settings,
      waterConsumption,
    });
    if (lines.length === 0) {
      result.skipped += 1;
      continue;
    }
    const total = invoiceTotal(lines);
    const dueDate = dueDateFor(period, settings.dueDay);

    if (dryRun) {
      result.created += 1;
      result.totalBilled += total;
      result.invoices.push({ unitCode: lease.unitCode, number: null, dueDate, total, lines });
      continue;
    }

    const createdInvoice = await database.transaction((transaction) =>
      createInvoice(transaction, { leaseId: lease.leaseId, period, lines, today, dueDate }),
    );

    if (!createdInvoice) {
      result.skipped += 1;
      continue;
    }
    result.created += 1;
    result.totalBilled += total;
    result.invoices.push({ unitCode: lease.unitCode, number: createdInvoice.number, dueDate, total, lines });
    await queueNotification("invoice", createdInvoice.id);
  }

  return result;
}

/** Queues an SMS; a queue failure is logged and never undoes billing. */
export async function queueNotification(kind: "invoice" | "penalty", id: string): Promise<void> {
  try {
    await queueJob("send-notification", { kind, id });
  } catch (error) {
    console.error(`Could not queue ${kind} notification for ${id}`, error);
  }
}

type InvoiceStatus = "paid" | "partial" | "unpaid" | "overdue";

/** Invoices with their lines, open amounts and status (for the sandbox and later screens). */
export async function listInvoices(input: { period: BillingPeriod; today?: IsoDate; buildingId?: string | null }) {
  const period = assertBillingPeriod(input.period);
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  const resolver = await loadPolicyResolver(database);

  const invoiceRows = await database
    .select({
      id: invoices.id,
      number: invoices.number,
      leaseId: invoices.leaseId,
      period: invoices.period,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      unitCode: units.code,
      buildingId: units.buildingId,
    })
    .from(invoices)
    .innerJoin(leases, eq(leases.id, invoices.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(eq(invoices.period, period), input.buildingId ? eq(units.buildingId, input.buildingId) : undefined))
    .orderBy(asc(invoices.number));

  const lines = await loadLines(database, [...new Set(invoiceRows.map((invoice) => invoice.leaseId))]);
  return invoiceRows.map((invoice) => {
    const own = lines.filter((line) => line.invoiceId === invoice.id);
    const open = sumShillings(own.map((line) => line.outstanding));
    const paid = sumShillings(own.map((line) => line.allocated));
    const waived = sumShillings(own.map((line) => line.waived));
    const graceDays = resolver(invoice.buildingId, today).settings.graceDays;
    const status: InvoiceStatus =
      open === 0 ? "paid" : today > graceEndsOn(invoice.dueDate, graceDays) ? "overdue" : paid > 0 ? "partial" : "unpaid";
    return {
      ...invoice,
      status,
      paid,
      waived,
      open,
      lines: own.map((line) => ({
        invoiceLineId: line.invoiceLineId,
        type: line.type,
        amount: line.amount,
        allocated: line.allocated,
        waived: line.waived,
        open: line.outstanding,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

export type PenaltyCandidate = {
  leaseId: string;
  unitCode: string;
  buildingId: string;
  overdueRent: Shillings;
  targetInvoiceId: string | null;
  targetInvoiceNumber: string | null;
  decision: PenaltyDecision;
};

/**
 * For each lease with overdue rent (open rent on invoices whose due date + grace days is before today),
 * decides the penalty under the given settings. The penalty goes on the current period's invoice if
 * there is one, otherwise on the latest unpaid invoice; "once"/"monthly" are counted on that invoice,
 * and a lease is never charged more than one penalty in the same period.
 */
export async function computePenaltyCandidates(
  database: Executor,
  input: { today: IsoDate; settingsFor: (buildingId: string) => PolicySettings; leaseIds?: readonly string[] },
): Promise<PenaltyCandidate[]> {
  const { today } = input;
  if (input.leaseIds && input.leaseIds.length === 0) return [];

  const leaseRows = await database
    .select({ leaseId: leases.id, unitCode: units.code, buildingId: units.buildingId })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(input.leaseIds ? inArray(leases.id, [...input.leaseIds]) : undefined);
  const lines = await loadLines(
    database,
    leaseRows.map((lease) => lease.leaseId),
  );

  const candidates: PenaltyCandidate[] = [];
  const pending: { candidate: PenaltyCandidate; settings: PolicySettings; earliestGraceEnd: IsoDate }[] = [];

  for (const lease of leaseRows) {
    const settings = input.settingsFor(lease.buildingId);
    const own = lines.filter((line) => line.leaseId === lease.leaseId);
    const overdue = own.filter(
      (line) => line.type === "rent" && line.outstanding > 0 && graceEndsOn(line.dueDate, settings.graceDays) < today,
    );
    const overdueRent = sumShillings(overdue.map((line) => line.outstanding));
    if (overdueRent <= 0) continue;

    // Target: the current period's invoice, else the latest invoice with anything open.
    const currentPeriod = periodOf(today);
    const current = own.find((line) => line.period === currentPeriod);
    const latestOpen = [...own].reverse().find((line) => line.outstanding > 0);
    const target = current ?? latestOpen ?? null;

    const candidate: PenaltyCandidate = {
      leaseId: lease.leaseId,
      unitCode: lease.unitCode,
      buildingId: lease.buildingId,
      overdueRent,
      targetInvoiceId: target?.invoiceId ?? null,
      targetInvoiceNumber: target?.invoiceNumber ?? null,
      decision: { apply: false, reason: "disabled" },
    };
    const earliestGraceEnd = overdue
      .map((line) => graceEndsOn(line.dueDate, settings.graceDays))
      .sort()[0] as IsoDate;
    pending.push({ candidate, settings, earliestGraceEnd });
  }

  const applied = await penaltyDates(
    database,
    pending.map((item) => item.candidate.leaseId),
  );

  for (const { candidate, settings, earliestGraceEnd } of pending) {
    // Never more than one penalty per lease in a period, whichever invoice it went on.
    const chargedThisPeriod = (applied.byLease.get(candidate.leaseId) ?? []).some((date) => periodOf(date) === periodOf(today));
    candidate.decision = chargedThisPeriod
      ? { apply: false, reason: "already_applied" }
      : candidate.targetInvoiceId
      ? decidePenalty({
          settings: settings.penalty,
          overdueAmount: candidate.overdueRent,
          graceEndsOn: earliestGraceEnd,
          today,
          appliedOn: applied.byInvoice.get(candidate.targetInvoiceId) ?? [],
        })
      : { apply: false, reason: "nothing_overdue" };
    candidates.push(candidate);
  }
  return candidates;
}

/** Dates (ledger entry dates) penalties were charged, per invoice and per lease. */
async function penaltyDates(database: Executor, leaseIds: readonly string[]) {
  const byInvoice = new Map<string, IsoDate[]>();
  const byLease = new Map<string, IsoDate[]>();
  if (leaseIds.length === 0) return { byInvoice, byLease };
  const rows = await database
    .select({ invoiceId: invoiceLines.invoiceId, leaseId: invoices.leaseId, entryDate: ledgerEntries.entryDate })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(ledgerEntries, and(eq(ledgerEntries.invoiceLineId, invoiceLines.id), eq(ledgerEntries.type, "charge")))
    .where(and(inArray(invoices.leaseId, [...leaseIds]), eq(invoiceLines.type, "penalty")));
  for (const row of rows) {
    byInvoice.set(row.invoiceId, [...(byInvoice.get(row.invoiceId) ?? []), row.entryDate]);
    byLease.set(row.leaseId, [...(byLease.get(row.leaseId) ?? []), row.entryDate]);
  }
  return { byInvoice, byLease };
}

/** Adds late-payment penalties where policy says so, then queues a notice for each. */
export async function applyPenalties(input: { today?: IsoDate } = {}): Promise<{
  leasesCharged: number;
  total: Shillings;
  charges: { unitCode: string; invoiceNumber: string; amount: Shillings }[];
}> {
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  const resolver = await loadPolicyResolver(database);
  const candidates = await computePenaltyCandidates(database, {
    today,
    settingsFor: (buildingId) => resolver(buildingId, today).settings,
  });

  const charges: { unitCode: string; invoiceNumber: string; amount: Shillings }[] = [];
  for (const candidate of candidates) {
    const decision = candidate.decision;
    if (!decision.apply || !candidate.targetInvoiceId) continue;
    const targetInvoiceId = candidate.targetInvoiceId;
    const repeat = resolver(candidate.buildingId, today).settings.penalty.repeat;

    const lineId = await database.transaction(async (transaction) => {
      await lockLease(transaction, candidate.leaseId);
      // Re-check under the lock so two overlapping runs can't both charge.
      const { byInvoice, byLease } = await penaltyDates(transaction, [candidate.leaseId]);
      const onInvoice = byInvoice.get(targetInvoiceId) ?? [];
      const inPeriod = (dates: IsoDate[]) => dates.some((date) => periodOf(date) === periodOf(today));
      if (inPeriod(byLease.get(candidate.leaseId) ?? [])) return null;
      if (onInvoice.length > 0 && (repeat === "once" || inPeriod(onInvoice))) return null;

      const [invoice] = await transaction
        .select({ number: invoices.number })
        .from(invoices)
        .where(eq(invoices.id, targetInvoiceId));
      if (!invoice) return null;

      const [line] = await transaction
        .insert(invoiceLines)
        .values({
          invoiceId: targetInvoiceId,
          type: "penalty",
          description: decision.description,
          quantity: 1,
          rate: decision.amount,
          amount: decision.amount,
        })
        .returning({ id: invoiceLines.id });
      if (!line) throw new Error("Penalty line insert returned no row");

      await transaction
        .update(invoices)
        .set({ total: sql`${invoices.total} + ${decision.amount}` })
        .where(eq(invoices.id, targetInvoiceId));
      await transaction.insert(ledgerEntries).values({
        leaseId: candidate.leaseId,
        entryDate: today,
        type: "charge",
        account: "rent",
        reference: invoice.number,
        debit: decision.amount,
        credit: 0,
        invoiceLineId: line.id,
      });
      await applyCredit(candidate.leaseId, transaction, today);
      return { id: line.id, invoiceNumber: invoice.number };
    });

    if (lineId) {
      charges.push({ unitCode: candidate.unitCode, invoiceNumber: lineId.invoiceNumber, amount: decision.amount });
      await queueNotification("penalty", lineId.id);
    }
  }

  return { leasesCharged: charges.length, total: sumShillings(charges.map((charge) => charge.amount)), charges };
}

/**
 * Credits part of a line inside a transaction: raises waived_amount and posts an adjustment credit linked to the line,
 * so open amounts and the ledger stay in step. The caller checks the amount is open.
 */
export async function creditLine(
  transaction: Transaction,
  input: { invoiceLineId: string; leaseId: string; amount: Shillings; reference: string; today: IsoDate },
): Promise<void> {
  if (input.amount <= 0) return;
  await transaction
    .update(invoiceLines)
    .set({ waivedAmount: sql`${invoiceLines.waivedAmount} + ${input.amount}` })
    .where(eq(invoiceLines.id, input.invoiceLineId));
  await transaction.insert(ledgerEntries).values({
    leaseId: input.leaseId,
    entryDate: input.today,
    type: "adjustment",
    account: "rent",
    reference: input.reference.slice(0, 200),
    debit: 0,
    credit: input.amount,
    invoiceLineId: input.invoiceLineId,
  });
}

/**
 * Takes up to `amount` of payment money back off a line (negative allocation rows, newest payments first),
 * leaving it as unallocated credit for applyCredit to place elsewhere. Returns how much was freed.
 */
export async function unallocateLine(transaction: Transaction, invoiceLineId: string, amount: Shillings): Promise<Shillings> {
  if (amount <= 0) return 0;
  const perPayment = await transaction
    .select({ paymentId: allocations.paymentId, net: sql<number>`sum(${allocations.amount})::int` })
    .from(allocations)
    .innerJoin(payments, eq(payments.id, allocations.paymentId))
    .where(eq(allocations.invoiceLineId, invoiceLineId))
    .groupBy(allocations.paymentId, payments.paidAt)
    .orderBy(desc(payments.paidAt));
  let remaining = amount;
  for (const row of perPayment) {
    if (remaining === 0) break;
    const take = Math.min(remaining, row.net);
    if (take <= 0) continue;
    await transaction.insert(allocations).values({ paymentId: row.paymentId, invoiceLineId, amount: -take });
    remaining -= take;
  }
  return amount - remaining;
}

/** Lines of one lease with their open amounts (for move-out and similar flows). */
export async function leaseLines(database: Executor, leaseId: string) {
  return loadLines(database, [leaseId]);
}

// ---------------------------------------------------------------------------
// Waivers and statements
// ---------------------------------------------------------------------------

/** Forgives part of a line: raises waived_amount, posts an adjustment credit, writes an audit row. */
export async function waiveCharge(input: {
  invoiceLineId: string;
  amount: Shillings;
  reason: string;
  actor: string;
  today?: IsoDate;
}) {
  assertShillings(input.amount, "amount");
  if (input.amount < 1) throw new BillingError("Amount must be at least 1");
  const reason = input.reason.trim();
  if (!reason) throw new BillingError("A reason is required");
  const today = input.today ?? todayInNairobi();

  return getDatabase().transaction(async (transaction) => {
    const [line] = await transaction
      .select({
        id: invoiceLines.id,
        type: invoiceLines.type,
        amount: invoiceLines.amount,
        waived: invoiceLines.waivedAmount,
        leaseId: invoices.leaseId,
      })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(eq(invoiceLines.id, input.invoiceLineId))
      .for("update", { of: invoiceLines });
    if (!line) throw new BillingError("Invoice line not found");
    await lockLease(transaction, line.leaseId);

    const [{ allocated } = { allocated: 0 }] = await transaction
      .select({ allocated: sql<number>`coalesce(sum(${allocations.amount}), 0)::int` })
      .from(allocations)
      .where(eq(allocations.invoiceLineId, line.id));
    const open = line.amount - allocated - line.waived;
    if (input.amount > open) throw new BillingError(`Only ${open} is unpaid on this line`);

    await transaction
      .update(invoiceLines)
      .set({ waivedAmount: line.waived + input.amount })
      .where(eq(invoiceLines.id, line.id));
    await transaction.insert(ledgerEntries).values({
      leaseId: line.leaseId,
      entryDate: today,
      type: "adjustment",
      account: accountForLine(line.type as InvoiceLineType),
      reference: reason.slice(0, 200),
      debit: 0,
      credit: input.amount,
      invoiceLineId: line.id,
    });
    await transaction.insert(auditLog).values({
      actor: input.actor,
      action: "invoice_line.waive",
      entity: "invoice_line",
      entityId: line.id,
      before: { waivedAmount: line.waived, open },
      after: { waivedAmount: line.waived + input.amount, open: open - input.amount },
      reason,
    });
    return { invoiceLineId: line.id, waived: input.amount, waivedAmount: line.waived + input.amount, open: open - input.amount };
  });
}

/** Opening balance, every ledger entry in date order with a running balance, and the closing balance. */
export async function getLeaseStatement(input: { leaseId: string; from?: IsoDate; to?: IsoDate }) {
  const database = getDatabase();
  const [lease] = await database
    .select({ id: leases.id, startDate: leases.startDate, unitCode: units.code })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, input.leaseId));
  if (!lease) throw new BillingError("Lease not found");

  const from = input.from ? assertIsoDate(input.from) : lease.startDate;
  // Default to today, or the lease start if the lease starts later (a move-in recorded in advance).
  const to = input.to ? assertIsoDate(input.to) : from > todayInNairobi() ? from : todayInNairobi();
  if (from > to) throw new BillingError("from must be on or before to");

  const [[opening], entries] = await Promise.all([
    database
      .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::int` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.leaseId, lease.id), lt(ledgerEntries.entryDate, from))),
    database
      .select({
        id: ledgerEntries.id,
        date: ledgerEntries.entryDate,
        type: ledgerEntries.type,
        account: ledgerEntries.account,
        reference: ledgerEntries.reference,
        debit: ledgerEntries.debit,
        credit: ledgerEntries.credit,
        description: invoiceLines.description,
      })
      .from(ledgerEntries)
      .leftJoin(invoiceLines, eq(invoiceLines.id, ledgerEntries.invoiceLineId))
      .where(and(eq(ledgerEntries.leaseId, lease.id), gte(ledgerEntries.entryDate, from), lte(ledgerEntries.entryDate, to)))
      // Entries from one transaction share a timestamp: within a day, show charges before credits.
      .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.createdAt), sql`case when ${ledgerEntries.debit} > 0 then 0 else 1 end`, asc(ledgerEntries.id)),
  ]);

  const openingBalance = opening?.balance ?? 0;
  let running = openingBalance;
  const lines = entries.map((entry) => {
    running += entry.debit - entry.credit;
    return { ...entry, balance: running };
  });
  return { leaseId: lease.id, unitCode: lease.unitCode, from, to, openingBalance, entries: lines, closingBalance: running };
}

/** Reading flags that still need the landlord (for the daily summary). */
export async function countReadingsToConfirm(database: Executor = getDatabase()): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(meterReadings)
    .where(and(eq(meterReadings.flagged, true), eq(meterReadings.confirmed, false)));
  return row?.count ?? 0;
}


// ---------------------------------------------------------------------------
// Reads for the landlord screens
// ---------------------------------------------------------------------------

/**
 * One row per unit of a building for entering a period's readings: previous reading, any reading already
 * saved for the period, recent consumptions (for the 3× check) and the water rates that apply.
 */
export async function getMeterReadingSheet(input: { buildingId: string; period: BillingPeriod; today?: IsoDate }) {
  const period = assertBillingPeriod(input.period);
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  // Independent reads run together: each round trip to the database costs ~200 ms from Kenya.
  const [resolver, unitRows] = await Promise.all([
    loadPolicyResolver(database),
    database
      .select({ unitId: units.id, code: units.code, meterNumber: units.meterNumber, status: units.status })
      .from(units)
      .where(eq(units.buildingId, input.buildingId))
      .orderBy(units.code),
  ]);
  const [saved, histories] = await Promise.all([
    unitRows.length
      ? database
          .select()
          .from(meterReadings)
          .where(and(eq(meterReadings.period, period), eq(meterReadings.kind, "regular"), inArray(meterReadings.unitId, unitRows.map((unit) => unit.unitId))))
      : Promise.resolve([]),
    readingHistories(database, unitRows.map((unit) => unit.unitId), today, period),
  ]);
  const water = resolver(input.buildingId, today).settings.water;
  const rows = [];
  for (const unit of unitRows) {
    const history = histories.get(unit.unitId)!;
    const existing = saved.find((reading) => reading.unitId === unit.unitId) ?? null;
    rows.push({
      unitId: unit.unitId,
      code: unit.code,
      meterNumber: unit.meterNumber,
      unitStatus: unit.status,
      previousReading: existing?.previousReading ?? history.previousReading,
      recentConsumptions: history.recentConsumptions,
      saved: existing
        ? { readingId: existing.id, currentReading: existing.currentReading, flagged: existing.flagged, confirmed: existing.confirmed }
        : null,
    });
  }
  return { period, ratePerUnit: water.ratePerUnit, standingCharge: water.standingCharge, rows };
}

/** A lease's invoices with paid and open amounts. */
export async function listInvoicesForLease(leaseId: string) {
  const lines = await loadLines(getDatabase(), [leaseId]);
  const byInvoice = new Map<string, { invoiceId: string; number: string; period: string; dueDate: string; total: number; paid: number; open: number }>();
  for (const line of lines) {
    const row = byInvoice.get(line.invoiceId) ?? { invoiceId: line.invoiceId, number: line.invoiceNumber, period: line.period, dueDate: line.dueDate, total: 0, paid: 0, open: 0 };
    row.total += line.amount - line.waived;
    row.paid += line.allocated;
    row.open += line.outstanding;
    byInvoice.set(line.invoiceId, row);
  }
  return [...byInvoice.values()].sort((a, b) => b.period.localeCompare(a.period));
}

/** Open lines of a lease (for the waive dialog). */
export async function listOpenLines(leaseId: string) {
  return (await loadLines(getDatabase(), [leaseId]))
    .filter((line) => line.outstanding > 0)
    .map((line) => ({ invoiceLineId: line.invoiceLineId, invoiceNumber: line.invoiceNumber, type: line.type, open: line.outstanding }));
}
