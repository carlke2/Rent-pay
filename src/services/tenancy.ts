import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { buildInvoiceLines, dueDateFor, prorateRent, waterCharge, type InvoiceLineDraft } from "@/core/billing";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase, type Executor, type Transaction } from "@/database/client";
import {
  allocations,
  buildings,
  invoiceLines,
  invoices,
  landlord,
  ledgerEntries,
  leases,
  meterReadings,
  rentChanges,
  tenants,
  units,
  type NextOfKin,
} from "@/database/schema";
import { assertIsoDate, firstDayOfPeriod, formatDate, laterDate, periodOf, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { assertShillings, sumShillings, type Shillings } from "@/utilities/money";
import { normaliseKenyanPhone } from "@/utilities/phone";
import { writeAudit } from "./audit";
import {
  addInvoiceLines,
  applyCredit,
  createInvoice,
  creditLine,
  leaseLines,
  loadRentResolver,
  queueNotification,
  readingHistory,
  unallocateLine,
} from "./billing";
import { assertDateOpen } from "./closed-periods";
import { ServiceError } from "./errors";
import { sendFinalStatement, sendWelcome } from "./notifications";
import { getPolicy } from "./policies";

class PreviewRollback<T> extends Error {
  constructor(readonly value: T) {
    super("preview rollback");
  }
}

/** Runs real service code in a transaction and always rolls it back, returning what it produced. */
async function previewInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
  try {
    await getDatabase().transaction(async (transaction) => {
      throw new PreviewRollback(await work(transaction));
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.value as T;
    throw error;
  }
  throw new Error("Preview did not run");
}

// ---------------------------------------------------------------------------
// Reads used by the tenant portal
// ---------------------------------------------------------------------------

/**
 * A tenant's current (active or on-notice) lease with its unit, or null.
 * With `leaseId` (the lease chosen at login), only that lease is returned.
 */
export async function getCurrentLeaseForTenant(tenantId: string, leaseId?: string | null) {
  const [row] = await getDatabase()
    .select({
      leaseId: leases.id,
      leaseStatus: leases.status,
      unitCode: units.code,
      buildingId: units.buildingId,
      tenantName: tenants.fullName,
      tenantPhone: tenants.phone,
    })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(
      and(
        eq(leases.tenantId, tenantId),
        inArray(leases.status, ["active", "notice"]),
        leaseId ? eq(leases.id, leaseId) : undefined,
      ),
    )
    .orderBy(desc(leases.startDate))
    .limit(1);
  return row ?? null;
}

/** A tenant's current leases (for choosing one at login). */
export async function listCurrentLeasesForTenant(tenantId: string) {
  return getDatabase()
    .select({ leaseId: leases.id, unitCode: units.code, buildingName: buildings.name })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(and(eq(leases.tenantId, tenantId), inArray(leases.status, ["active", "notice"])))
    .orderBy(units.code);
}

/** A lease's balance: the sum of its ledger entries (positive = owes, negative = credit). */
export async function leaseBalance(leaseId: string, database: Executor = getDatabase()): Promise<number> {
  const [row] = await database
    .select({ balance: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.leaseId, leaseId));
  return row?.balance ?? 0;
}

/**
 * Deposit held = payments allocated to the lease's deposit lines − deposit refunded.
 * (Applying the deposit at move-out moves those allocations off the deposit lines, so it is already netted.)
 */
export async function depositHeld(leaseId: string, database: Executor = getDatabase()): Promise<Shillings> {
  const [[row], [lease]] = await Promise.all([
    database
      .select({
        allocated: sql<number>`coalesce(sum(${allocations.amount}), 0)::int`,
      })
      .from(allocations)
      .innerJoin(invoiceLines, eq(invoiceLines.id, allocations.invoiceLineId))
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(eq(invoices.leaseId, leaseId), eq(invoiceLines.type, "deposit"))),
    database.select({ refunded: leases.depositRefundedAmount }).from(leases).where(eq(leases.id, leaseId)),
  ]);
  return Math.max(0, (row?.allocated ?? 0) - (lease?.refunded ?? 0));
}

// ---------------------------------------------------------------------------
// Buildings, units, tenants
// ---------------------------------------------------------------------------

function requireText(value: string | undefined | null, label: string): string {
  const text = value?.trim();
  if (!text) throw new ServiceError(`${label} is required`);
  return text;
}

function wholeAmount(value: number, label: string): Shillings {
  if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError(`${label} must be a whole number of shillings`);
  return value;
}

/** Postgres unique violation (Drizzle wraps the driver error in `cause`). */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

export async function createBuilding(input: { name: string; location?: string | null; codePrefix: string; actor: string }) {
  const values = {
    name: requireText(input.name, "Name"),
    location: input.location?.trim() || null,
    codePrefix: normaliseUnitCode(requireText(input.codePrefix, "Code prefix")),
  };
  try {
    return await getDatabase().transaction(async (transaction) => {
      const [building] = await transaction.insert(buildings).values(values).returning();
      await writeAudit(transaction, { actor: input.actor, action: "building.create", entity: "building", entityId: building?.id, after: building });
      return building;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError(`Code prefix ${values.codePrefix} is already used`);
    throw error;
  }
}

export async function updateBuilding(input: {
  buildingId: string;
  changes: { name?: string; location?: string | null; codePrefix?: string };
  actor: string;
  reason?: string;
}) {
  try {
    return await getDatabase().transaction(async (transaction) => {
      const [before] = await transaction.select().from(buildings).where(eq(buildings.id, input.buildingId)).for("update");
      if (!before) throw new ServiceError("Building not found");
      const changes: Partial<typeof buildings.$inferInsert> = {};
      if (input.changes.name !== undefined) changes.name = requireText(input.changes.name, "Name");
      if (input.changes.location !== undefined) changes.location = input.changes.location?.trim() || null;
      if (input.changes.codePrefix !== undefined) changes.codePrefix = normaliseUnitCode(requireText(input.changes.codePrefix, "Code prefix"));
      if (Object.keys(changes).length === 0) return before;
      const [after] = await transaction.update(buildings).set(changes).where(eq(buildings.id, input.buildingId)).returning();
      await writeAudit(transaction, { actor: input.actor, action: "building.update", entity: "building", entityId: before.id, before, after, reason: input.reason });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError("That code prefix is already used");
    throw error;
  }
}

/** Display form of a unit code: trimmed and uppercase (uniqueness is checked on the normalised form, e.g. KILA04). */
function cleanUnitCode(code: string): string {
  const cleaned = requireText(code, "Unit code").toUpperCase().replace(/\s+/g, "");
  if (!normaliseUnitCode(cleaned)) throw new ServiceError("Unit code is required");
  if (cleaned.length > 12) throw new ServiceError("Unit code must be at most 12 characters (the M-Pesa account number limit)");
  return cleaned;
}

export async function createUnit(input: {
  buildingId: string;
  code: string;
  type: string;
  floor?: number | null;
  rentAmount: number;
  depositAmount?: number;
  meterNumber?: string | null;
  actor: string;
}) {
  const code = cleanUnitCode(input.code);
  try {
    return await getDatabase().transaction(async (transaction) => {
      const [building] = await transaction.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, input.buildingId));
      if (!building) throw new ServiceError("Building not found");
      const [unit] = await transaction
        .insert(units)
        .values({
          buildingId: input.buildingId,
          code,
          type: requireText(input.type, "Type"),
          floor: input.floor ?? null,
          rentAmount: wholeAmount(input.rentAmount, "Rent"),
          depositAmount: wholeAmount(input.depositAmount ?? 0, "Deposit"),
          meterNumber: input.meterNumber?.trim() || null,
          status: "vacant",
        })
        .returning();
      await writeAudit(transaction, { actor: input.actor, action: "unit.create", entity: "unit", entityId: unit?.id, after: unit });
      return unit;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError(`A unit with code ${code} (or the same code without dashes/spaces) already exists`);
    throw error;
  }
}

export async function updateUnit(input: {
  unitId: string;
  changes: {
    code?: string;
    type?: string;
    floor?: number | null;
    rentAmount?: number;
    depositAmount?: number;
    meterNumber?: string | null;
    status?: "vacant" | "reserved" | "under_repair";
  };
  actor: string;
  reason?: string;
}) {
  try {
    return await getDatabase().transaction(async (transaction) => {
      const [before] = await transaction.select().from(units).where(eq(units.id, input.unitId)).for("update");
      if (!before) throw new ServiceError("Unit not found");
      const changes: Partial<typeof units.$inferInsert> = {};
      const c = input.changes;
      if (c.code !== undefined) changes.code = cleanUnitCode(c.code);
      if (c.type !== undefined) changes.type = requireText(c.type, "Type");
      if (c.floor !== undefined) changes.floor = c.floor;
      if (c.rentAmount !== undefined) changes.rentAmount = wholeAmount(c.rentAmount, "Rent");
      if (c.depositAmount !== undefined) changes.depositAmount = wholeAmount(c.depositAmount, "Deposit");
      if (c.meterNumber !== undefined) changes.meterNumber = c.meterNumber?.trim() || null;
      if (c.status !== undefined) {
        // occupied/vacant follow move-in and move-out; manual status changes are only for units without a tenant.
        const [current] = await transaction
          .select({ id: leases.id })
          .from(leases)
          .where(and(eq(leases.unitId, before.id), ne(leases.status, "ended")))
          .limit(1);
        if (current) throw new ServiceError("This unit has a current lease; use move-out first");
        changes.status = c.status;
      }
      if (Object.keys(changes).length === 0) return before;
      const [after] = await transaction.update(units).set(changes).where(eq(units.id, input.unitId)).returning();
      await writeAudit(transaction, { actor: input.actor, action: "unit.update", entity: "unit", entityId: before.id, before, after, reason: input.reason });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError("Another unit already uses that code");
    throw error;
  }
}

type TenantDetails = {
  fullName: string;
  phone: string;
  nationalId?: string | null;
  alternativePhone?: string | null;
  whatsappOptIn?: boolean;
  nextOfKin?: NextOfKin | null;
};

function cleanPhone(phone: string, label = "Phone"): string {
  const normalised = normaliseKenyanPhone(phone);
  if (!normalised) throw new ServiceError(`${label} must be a valid Kenyan mobile number`);
  return normalised;
}

export async function updateTenant(input: {
  tenantId: string;
  changes: Partial<TenantDetails> & { portalAccess?: boolean };
  actor: string;
  reason?: string;
}) {
  try {
    return await getDatabase().transaction(async (transaction) => {
      const [before] = await transaction.select().from(tenants).where(eq(tenants.id, input.tenantId)).for("update");
      if (!before) throw new ServiceError("Tenant not found");
      const c = input.changes;
      const changes: Partial<typeof tenants.$inferInsert> = {};
      if (c.fullName !== undefined) changes.fullName = requireText(c.fullName, "Full name");
      if (c.phone !== undefined) changes.phone = cleanPhone(c.phone);
      if (c.alternativePhone !== undefined) changes.alternativePhone = c.alternativePhone ? cleanPhone(c.alternativePhone, "Alternative phone") : null;
      if (c.nationalId !== undefined) changes.nationalId = c.nationalId?.trim() || null;
      if (c.whatsappOptIn !== undefined) changes.whatsappOptIn = c.whatsappOptIn;
      if (c.nextOfKin !== undefined) changes.nextOfKin = c.nextOfKin;
      if (c.portalAccess !== undefined) changes.portalAccess = c.portalAccess;
      if (Object.keys(changes).length === 0) return before;
      const [after] = await transaction.update(tenants).set(changes).where(eq(tenants.id, input.tenantId)).returning();
      await writeAudit(transaction, { actor: input.actor, action: "tenant.update", entity: "tenant", entityId: before.id, before, after, reason: input.reason });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError("Another tenant already uses that phone number");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Move-in, notice, rent changes
// ---------------------------------------------------------------------------

/**
 * Moves a tenant into a vacant unit: reuses the tenant if the phone is known, creates an active lease,
 * marks the unit occupied, saves the opening meter reading (confirmed) and creates the first invoice
 * (deposit, plus rent prorated from the start date when policy.prorate is on). Then sends a welcome SMS.
 */
export type MoveInInput = {
  unitId: string;
  tenant: TenantDetails | { tenantId: string };
  startDate: IsoDate;
  rentAmount?: number;
  depositAmount?: number;
  openingReading?: number | null;
  actor: string;
  today?: IsoDate;
};

function prepareMoveIn(input: Omit<MoveInInput, "actor">) {
  const startDate = assertIsoDate(input.startDate);
  const today = input.today ?? todayInNairobi();
  if (input.openingReading !== undefined && input.openingReading !== null) {
    if (!Number.isSafeInteger(input.openingReading) || input.openingReading < 0) throw new ServiceError("Opening reading must be a whole number");
  }
  return { startDate, today };
}

async function moveInWithin(transaction: Transaction, input: MoveInInput, startDate: IsoDate, today: IsoDate) {
  const [unit] = await transaction.select().from(units).where(eq(units.id, input.unitId)).for("update");
  if (!unit) throw new ServiceError("Unit not found");
  if (unit.status !== "vacant") throw new ServiceError(`Unit ${unit.code} is not vacant (${unit.status})`);
  if (unit.meterNumber && (input.openingReading === undefined || input.openingReading === null)) {
    throw new ServiceError(`Unit ${unit.code} has a water meter: an opening reading is required`);
  }

  // Tenant: by id, by known phone, or new.
  let tenantId: string;
  let tenantCreated = false;
  if ("tenantId" in input.tenant) {
    const [existing] = await transaction.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, input.tenant.tenantId));
    if (!existing) throw new ServiceError("Tenant not found");
    tenantId = existing.id;
  } else {
    const phone = cleanPhone(input.tenant.phone);
    const [existing] = await transaction.select({ id: tenants.id }).from(tenants).where(eq(tenants.phone, phone));
    if (existing) {
      tenantId = existing.id;
    } else {
      const [created] = await transaction
        .insert(tenants)
        .values({
          fullName: requireText(input.tenant.fullName, "Full name"),
          phone,
          nationalId: input.tenant.nationalId?.trim() || null,
          alternativePhone: input.tenant.alternativePhone ? cleanPhone(input.tenant.alternativePhone, "Alternative phone") : null,
          whatsappOptIn: input.tenant.whatsappOptIn ?? false,
          nextOfKin: input.tenant.nextOfKin ?? null,
        })
        .returning({ id: tenants.id });
      if (!created) throw new Error("Tenant insert returned no row");
      tenantId = created.id;
      tenantCreated = true;
    }
  }

  const rentAmount = wholeAmount(input.rentAmount ?? unit.rentAmount, "Rent");
  const depositAmount = wholeAmount(input.depositAmount ?? unit.depositAmount, "Deposit");
  const [lease] = await transaction
    .insert(leases)
    .values({ tenantId, unitId: unit.id, startDate, rentAmount, depositAmount, status: "active" })
    .returning({ id: leases.id });
  if (!lease) throw new Error("Lease insert returned no row");
  await transaction.update(units).set({ status: "occupied" }).where(eq(units.id, unit.id));

  const period = periodOf(startDate);
  if (input.openingReading !== undefined && input.openingReading !== null) {
    const reading = {
      unitId: unit.id,
      period,
      kind: "opening" as const,
      previousReading: input.openingReading,
      currentReading: input.openingReading,
      readOn: startDate,
      flagged: false,
      confirmed: true,
    };
    await transaction
      .insert(meterReadings)
      .values(reading)
      .onConflictDoUpdate({ target: [meterReadings.unitId, meterReadings.period, meterReadings.kind], set: reading });
  }

  const { settings } = await getPolicy(unit.buildingId, startDate, transaction);
  const lines = buildInvoiceLines({
    period,
    lease: { startDate, endDate: null, rentAmount, depositAmount },
    settings,
    waterConsumption: null,
    includeDeposit: true,
  });
  const dueDate = laterDate(dueDateFor(period, settings.dueDay), startDate);
  const invoice = lines.length ? await createInvoice(transaction, { leaseId: lease.id, period, lines, today, dueDate }) : null;

  await writeAudit(transaction, {
    actor: input.actor,
    action: "lease.move_in",
    entity: "lease",
    entityId: lease.id,
    after: { unitId: unit.id, unitCode: unit.code, tenantId, tenantCreated, startDate, rentAmount, depositAmount, openingReading: input.openingReading ?? null, invoice },
  });
  return { leaseId: lease.id, tenantId, tenantCreated, unitCode: unit.code, invoice, lines };
}

export async function moveIn(input: MoveInInput) {
  const { startDate, today } = prepareMoveIn(input);
  await assertDateOpen(startDate, "The move-in date");
  const result = await getDatabase().transaction((transaction) => moveInWithin(transaction, input, startDate, today));

  await sendWelcome(result.leaseId);
  if (result.invoice) await queueNotification("invoice", result.invoice.id);
  return result;
}

/** Exactly what moveIn would do (tenant, lease, first invoice lines), without saving anything or sending SMS. */
export async function previewMoveIn(input: Omit<MoveInInput, "actor">) {
  const { startDate, today } = prepareMoveIn(input);
  await assertDateOpen(startDate, "The move-in date");
  return previewInTransaction((transaction) => moveInWithin(transaction, { ...input, actor: "preview" }, startDate, today));
}

export async function giveNotice(input: { leaseId: string; noticeDate: IsoDate; moveOutDate: IsoDate; actor: string; reason?: string }) {
  const noticeDate = assertIsoDate(input.noticeDate);
  const moveOutDate = assertIsoDate(input.moveOutDate);
  if (moveOutDate < noticeDate) throw new ServiceError("Move-out date must be on or after the notice date");
  return getDatabase().transaction(async (transaction) => {
    const [before] = await transaction.select().from(leases).where(eq(leases.id, input.leaseId)).for("update");
    if (!before) throw new ServiceError("Lease not found");
    if (before.status !== "active") throw new ServiceError(`Lease is ${before.status}, not active`);
    if (moveOutDate < before.startDate) throw new ServiceError("Move-out date is before the lease started");
    // end_date lets invoices for the last month be prorated automatically.
    const [after] = await transaction
      .update(leases)
      .set({ status: "notice", noticeDate, moveOutDate, endDate: moveOutDate })
      .where(eq(leases.id, input.leaseId))
      .returning();
    await writeAudit(transaction, { actor: input.actor, action: "lease.notice", entity: "lease", entityId: input.leaseId, before, after, reason: input.reason });
    return after;
  });
}

export async function changeRent(input: { leaseId: string; amount: number; effectiveFrom: IsoDate; actor: string; reason?: string }) {
  const effectiveFrom = assertIsoDate(input.effectiveFrom);
  const amount = wholeAmount(input.amount, "Rent");
  return getDatabase().transaction(async (transaction) => {
    const [lease] = await transaction.select().from(leases).where(eq(leases.id, input.leaseId)).for("update");
    if (!lease) throw new ServiceError("Lease not found");
    if (lease.status === "ended") throw new ServiceError("This lease has ended");
    if (effectiveFrom < lease.startDate) throw new ServiceError("The change can't start before the lease");
    const rentFor = await loadRentResolver(transaction, [lease.id]);
    const previous = rentFor(lease.id, effectiveFrom, lease.rentAmount);
    const [change] = await transaction.insert(rentChanges).values({ leaseId: lease.id, amount, effectiveFrom }).returning();
    await writeAudit(transaction, {
      actor: input.actor,
      action: "lease.rent_change",
      entity: "lease",
      entityId: lease.id,
      before: { rent: previous, effectiveFrom },
      after: { rent: amount, effectiveFrom },
      reason: input.reason,
    });
    return change;
  });
}

// ---------------------------------------------------------------------------
// Move-out and deposit
// ---------------------------------------------------------------------------

/**
 * Ends a lease in ONE transaction: final water charge, credit for unused days (when the month was billed in
 * full and policy.prorate is on), deductions as "other" lines, unpaid deposit cancelled, the deposit held
 * applied to the remaining balance (the rest becomes deposit_refund_due), lease ended and unit vacant.
 * Then sends a final statement SMS.
 */
export type MoveOutInput = {
  leaseId: string;
  moveOutDate: IsoDate;
  finalReading?: number | null;
  deductions?: readonly { description: string; amount: number }[];
  actor: string;
  today?: IsoDate;
};

function prepareMoveOut(input: Omit<MoveOutInput, "actor">) {
  const moveOutDate = assertIsoDate(input.moveOutDate);
  const today = input.today ?? todayInNairobi();
  const deductions = (input.deductions ?? []).map((item) => ({
    description: requireText(item.description, "Deduction description"),
    amount: assertShillings(item.amount, "Deduction amount"),
  }));
  if (deductions.some((item) => item.amount < 1)) throw new ServiceError("Each deduction must be at least 1");
  return { moveOutDate, today, deductions };
}

async function moveOutWithin(
  transaction: Transaction,
  input: MoveOutInput,
  moveOutDate: IsoDate,
  today: IsoDate,
  deductions: { description: string; amount: number }[],
) {
  const [lease] = await transaction
    .select({
      id: leases.id,
      status: leases.status,
      startDate: leases.startDate,
      rentAmount: leases.rentAmount,
      depositAmount: leases.depositAmount,
      unitId: units.id,
      unitCode: units.code,
      buildingId: units.buildingId,
      meterNumber: units.meterNumber,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, input.leaseId))
    .for("update", { of: leases });
  if (!lease) throw new ServiceError("Lease not found");
  if (lease.status === "ended") throw new ServiceError("This lease has already ended");
  if (moveOutDate < lease.startDate) throw new ServiceError("Move-out date is before the lease started");
  if (lease.meterNumber && (input.finalReading === undefined || input.finalReading === null)) {
    throw new ServiceError(`Unit ${lease.unitCode} has a water meter: a final reading is required`);
  }

  const period = periodOf(moveOutDate);
  const { settings } = await getPolicy(lease.buildingId, moveOutDate, transaction);
  const rentFor = await loadRentResolver(transaction, [lease.id]);
  const monthlyRent = rentFor(lease.id, firstDayOfPeriod(period), lease.rentAmount);

  // 1. The move-out month's invoice: use it, or create it (prorated to the move-out date).
  const [existingInvoice] = await transaction
    .select({ id: invoices.id, number: invoices.number })
    .from(invoices)
    .where(and(eq(invoices.leaseId, lease.id), eq(invoices.period, period)));
  let invoice = existingInvoice ?? null;
  let unusedDaysCredit = 0;

  if (!invoice) {
    const lines = buildInvoiceLines({
      period,
      lease: { startDate: lease.startDate, endDate: moveOutDate, rentAmount: monthlyRent, depositAmount: lease.depositAmount },
      settings,
      waterConsumption: null,
    });
    invoice = await createInvoice(transaction, {
      leaseId: lease.id,
      period,
      lines,
      today,
      dueDate: laterDate(dueDateFor(period, settings.dueDay), today),
    });
    if (!invoice) throw new Error("Could not create the move-out invoice");
  } else if (settings.prorate) {
    // 2. Credit unused days if the month was charged for more days than occupied.
    const expected = prorateRent({
      monthlyRent,
      period,
      occupiedFrom: lease.startDate,
      occupiedTo: moveOutDate,
      prorate: true,
    }).amount;
    const rentLines = (await leaseLines(transaction, lease.id)).filter((line) => line.invoiceId === invoice?.id && line.type === "rent");
    const charged = sumShillings(rentLines.map((line) => line.amount - line.waived));
    let toCredit = Math.max(0, charged - expected);
    for (const line of rentLines) {
      if (toCredit === 0) break;
      const room = line.amount - line.waived;
      const credit = Math.min(toCredit, room);
      if (credit <= 0) continue;
      // If part of it was already paid, move that payment money off the line first (it becomes credit).
      if (line.outstanding < credit) await unallocateLine(transaction, line.invoiceLineId, credit - line.outstanding);
      await creditLine(transaction, {
        invoiceLineId: line.invoiceLineId,
        leaseId: lease.id,
        amount: credit,
        reference: `Unused days credit (moved out ${formatDate(moveOutDate)})`,
        today,
      });
      unusedDaysCredit += credit;
      toCredit -= credit;
    }
  }

  // 3. Final water and deductions.
  const extraLines: InvoiceLineDraft[] = [];
  let finalWater: { previousReading: number; finalReading: number; consumption: number; amount: number } | null = null;
  if (input.finalReading !== undefined && input.finalReading !== null) {
    const history = await readingHistory(transaction, lease.unitId, moveOutDate);
    const previousReading = history.previousReading ?? input.finalReading;
    const consumption = input.finalReading - previousReading;
    if (consumption < 0) throw new ServiceError(`Final reading ${input.finalReading} is lower than the last reading ${previousReading}`);
    const charge = waterCharge({ consumption, ratePerUnit: settings.water.ratePerUnit, standingCharge: 0 });
    const reading = {
      unitId: lease.unitId,
      period,
      kind: "final" as const,
      previousReading,
      currentReading: input.finalReading,
      readOn: moveOutDate,
      flagged: false,
      confirmed: true,
    };
    await transaction
      .insert(meterReadings)
      .values(reading)
      .onConflictDoUpdate({ target: [meterReadings.unitId, meterReadings.period, meterReadings.kind], set: reading });
    finalWater = { previousReading, finalReading: input.finalReading, consumption, amount: charge.total };
    if (charge.total > 0) {
      extraLines.push({
        type: "water",
        description: `Final water (${consumption} units)`,
        quantity: consumption,
        rate: settings.water.ratePerUnit,
        amount: charge.total,
      });
    }
  }
  for (const item of deductions) {
    extraLines.push({ type: "other", description: item.description, quantity: 1, rate: item.amount, amount: item.amount });
  }
  await addInvoiceLines(transaction, { invoiceId: invoice.id, invoiceNumber: invoice.number, leaseId: lease.id, lines: extraLines, today });
  await applyCredit(lease.id, transaction, today);

  // 4. Deposit: cancel any unpaid part, then apply what is held to the remaining balance.
  const allLines = await leaseLines(transaction, lease.id);
  for (const line of allLines.filter((item) => item.type === "deposit" && item.outstanding > 0)) {
    await creditLine(transaction, {
      invoiceLineId: line.invoiceLineId,
      leaseId: lease.id,
      amount: line.outstanding,
      reference: "Unpaid deposit cancelled at move-out",
      today,
    });
  }
  const held = await depositHeld(lease.id, transaction);
  const balanceBefore = await leaseBalance(lease.id, transaction);
  const depositApplied = Math.min(held, Math.max(0, balanceBefore));
  if (depositApplied > 0) {
    // Move the deposit money off the deposit lines, close those lines with a "Deposit applied" credit,
    // then let applyCredit place the freed money on the open charges.
    let remaining = depositApplied;
    for (const line of allLines.filter((item) => item.type === "deposit")) {
      if (remaining === 0) break;
      const freed = await unallocateLine(transaction, line.invoiceLineId, remaining);
      if (freed > 0) {
        await creditLine(transaction, { invoiceLineId: line.invoiceLineId, leaseId: lease.id, amount: freed, reference: "Deposit applied", today });
        remaining -= freed;
      }
    }
    await applyCredit(lease.id, transaction, today);
  }
  const depositRefundDue = held - depositApplied;
  const closingBalance = await leaseBalance(lease.id, transaction);

  await transaction
    .update(leases)
    .set({ status: "ended", endDate: moveOutDate, moveOutDate, depositRefundDue })
    .where(eq(leases.id, lease.id));
  await transaction.update(units).set({ status: "vacant" }).where(eq(units.id, lease.unitId));

  const result = {
    leaseId: lease.id,
    unitId: lease.unitId,
    unitCode: lease.unitCode,
    moveOutDate,
    invoiceNumber: invoice.number,
    finalWater,
    unusedDaysCredit,
    deductions: sumShillings(deductions.map((item) => item.amount)),
    depositHeld: held,
    depositApplied,
    depositRefundDue,
    closingBalance,
    creditOwedToTenant: Math.max(0, -closingBalance),
  };
  await writeAudit(transaction, { actor: input.actor, action: "lease.move_out", entity: "lease", entityId: lease.id, before: { status: lease.status }, after: result });
  return result;
}

export async function moveOut(input: MoveOutInput) {
  const { moveOutDate, today, deductions } = prepareMoveOut(input);
  const summary = await getDatabase().transaction((transaction) => moveOutWithin(transaction, input, moveOutDate, today, deductions));

  await sendFinalStatement({
    leaseId: summary.leaseId,
    balance: summary.closingBalance,
    depositApplied: summary.depositApplied,
    depositRefundDue: summary.depositRefundDue,
  });
  return summary;
}

/** Exactly what moveOut would do (final charges, credits, deposit applied, refund due), without saving or sending SMS. */
export async function previewMoveOut(input: Omit<MoveOutInput, "actor">) {
  const { moveOutDate, today, deductions } = prepareMoveOut(input);
  return previewInTransaction((transaction) => moveOutWithin(transaction, { ...input, actor: "preview" }, moveOutDate, today, deductions));
}

/** Records money paid back to a tenant from their deposit. No ledger entry: the deposit held goes down. */
export async function recordDepositRefund(input: {
  leaseId: string;
  amount: number;
  method: string;
  reference?: string | null;
  refundedOn: IsoDate;
  actor: string;
}) {
  const refundedOn = assertIsoDate(input.refundedOn);
  const amount = assertShillings(input.amount, "amount");
  if (amount < 1) throw new ServiceError("Amount must be at least 1");
  const method = requireText(input.method, "Method");
  return getDatabase().transaction(async (transaction: Transaction) => {
    const [before] = await transaction.select().from(leases).where(eq(leases.id, input.leaseId)).for("update");
    if (!before) throw new ServiceError("Lease not found");
    if (before.status !== "ended") throw new ServiceError("Deposits are refunded after move-out");
    const remaining = before.depositRefundDue - before.depositRefundedAmount;
    if (amount > remaining) throw new ServiceError(`Only ${remaining} of the deposit is left to refund`);
    const [after] = await transaction
      .update(leases)
      .set({ depositRefundedAmount: before.depositRefundedAmount + amount, depositRefundedOn: refundedOn })
      .where(eq(leases.id, input.leaseId))
      .returning();
    await writeAudit(transaction, {
      actor: input.actor,
      action: "lease.deposit_refund",
      entity: "lease",
      entityId: input.leaseId,
      before: { depositRefundedAmount: before.depositRefundedAmount },
      after: { depositRefundedAmount: after?.depositRefundedAmount, amount, method, reference: input.reference ?? null, refundedOn },
    });
    return { leaseId: input.leaseId, refunded: amount, totalRefunded: after?.depositRefundedAmount ?? 0, stillDue: remaining - amount };
  });
}

// ---------------------------------------------------------------------------
// Reads for the landlord screens
// ---------------------------------------------------------------------------

export async function listBuildings() {
  return getDatabase()
    .select({
      id: buildings.id,
      name: buildings.name,
      location: buildings.location,
      codePrefix: buildings.codePrefix,
      units: sql<number>`(select count(*) from units u where u.building_id = "buildings"."id")::int`,
      occupied: sql<number>`(select count(*) from leases l join units u on u.id = l.unit_id where u.building_id = "buildings"."id" and l.status <> 'ended')::int`,
    })
    .from(buildings)
    .orderBy(buildings.name);
}

export async function getBuilding(buildingId: string) {
  const [building] = await getDatabase().select().from(buildings).where(eq(buildings.id, buildingId));
  return building ?? null;
}

/** Everything the unit page shows: unit, current lease, meter history and past tenants. */
export async function getUnitDetail(unitId: string, today: IsoDate = todayInNairobi()) {
  const database = getDatabase();
  const [[unit], leaseRows, readings] = await Promise.all([
    database
      .select({ unit: units, buildingName: buildings.name })
      .from(units)
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .where(eq(units.id, unitId)),
    database
      .select({
        leaseId: leases.id,
        status: leases.status,
        startDate: leases.startDate,
        endDate: leases.endDate,
        noticeDate: leases.noticeDate,
        moveOutDate: leases.moveOutDate,
        rentAmount: leases.rentAmount,
        depositAmount: leases.depositAmount,
        depositRefundDue: leases.depositRefundDue,
        depositRefundedAmount: leases.depositRefundedAmount,
        tenantId: tenants.id,
        tenantName: tenants.fullName,
        tenantPhone: tenants.phone,
      })
      .from(leases)
      .innerJoin(tenants, eq(tenants.id, leases.tenantId))
      .where(eq(leases.unitId, unitId))
      .orderBy(desc(leases.startDate)),
    database
      .select()
      .from(meterReadings)
      .where(eq(meterReadings.unitId, unitId))
      .orderBy(desc(meterReadings.readOn), desc(meterReadings.createdAt))
      .limit(24),
  ]);
  if (!unit) return null;

  const currentRow = leaseRows.find((lease) => lease.status !== "ended") ?? null;
  let current = null;
  if (currentRow) {
    const [rentFor, balance, held] = await Promise.all([
      loadRentResolver(database, [currentRow.leaseId]),
      leaseBalance(currentRow.leaseId),
      depositHeld(currentRow.leaseId),
    ]);
    current = {
      ...currentRow,
      rentNow: rentFor(currentRow.leaseId, today, currentRow.rentAmount),
      balance,
      depositHeld: held,
    };
  }
  return {
    unit: unit.unit,
    buildingName: unit.buildingName,
    current,
    pastLeases: leaseRows.filter((lease) => lease.status === "ended"),
    readings: readings.map((reading) => ({ ...reading, consumption: Math.max(0, reading.currentReading - reading.previousReading) })),
  };
}

export type TenantListFilter = "all" | "active" | "notice" | "ended" | "owing";

/** Tenants with their units, lease status and total balance. */
export async function listTenants(input: { search?: string; status?: TenantListFilter } = {}) {
  const search = input.search?.trim();
  const rows = await getDatabase().execute(sql`
    select t.id as "tenantId", t.full_name as "fullName", t.phone, t.portal_access as "portalAccess", t.avatar_key as "avatarKey",
      coalesce(string_agg(distinct u.code, ', ') filter (where l.status <> 'ended'), string_agg(distinct u.code, ', ')) as units,
      case when bool_or(l.status = 'active') then 'active' when bool_or(l.status = 'notice') then 'notice' when count(l.id) > 0 then 'ended' else 'none' end as "leaseStatus",
      coalesce((select sum(le.debit - le.credit) from ledger_entries le join leases l2 on l2.id = le.lease_id where l2.tenant_id = t.id), 0)::int as balance
    from tenants t
    left join leases l on l.tenant_id = t.id
    left join units u on u.id = l.unit_id
    where ${search ? sql`(t.full_name ilike ${`%${search}%`} or t.phone like ${`%${search.replace(/\D/g, "").replace(/^0/, "")}%`} or u.code ilike ${`%${search}%`})` : sql`true`}
    group by t.id
    order by t.full_name`);
  const list = [...rows] as {
    tenantId: string;
    fullName: string;
    phone: string;
    portalAccess: boolean;
    avatarKey: string | null;
    units: string | null;
    leaseStatus: "active" | "notice" | "ended" | "none";
    balance: number;
  }[];
  const status = input.status ?? "all";
  return list.filter((row) =>
    status === "all" ? true : status === "owing" ? row.balance > 0 : row.leaseStatus === status,
  );
}

export async function getTenantDetail(tenantId: string) {
  const database = getDatabase();
  const [[tenant], leaseRows] = await Promise.all([
    database.select().from(tenants).where(eq(tenants.id, tenantId)),
    database
      .select({
        leaseId: leases.id,
        status: leases.status,
        startDate: leases.startDate,
        endDate: leases.endDate,
        unitId: units.id,
        unitCode: units.code,
        buildingName: buildings.name,
        balance: sql<number>`coalesce((select sum(le.debit - le.credit) from ledger_entries le where le.lease_id = "leases"."id"), 0)::int`,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .where(eq(leases.tenantId, tenantId))
      .orderBy(sql`case when ${leases.status} = 'ended' then 1 else 0 end`, desc(leases.startDate)),
  ]);
  if (!tenant) return null;
  return { tenant, leases: leaseRows };
}

/** Vacant units for the move-in wizard. */
export async function listVacantUnits() {
  return getDatabase()
    .select({
      unitId: units.id,
      code: units.code,
      type: units.type,
      buildingName: buildings.name,
      rentAmount: units.rentAmount,
      depositAmount: units.depositAmount,
      meterNumber: units.meterNumber,
    })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(eq(units.status, "vacant"))
    .orderBy(buildings.name, units.code);
}

/** Current leases (active or on notice) for pickers: move-out, payments, assignments. */
export async function listCurrentLeases() {
  return getDatabase()
    .select({
      leaseId: leases.id,
      status: leases.status,
      moveOutDate: leases.moveOutDate,
      unitCode: units.code,
      meterNumber: units.meterNumber,
      buildingName: buildings.name,
      tenantName: tenants.fullName,
      tenantPhone: tenants.phone,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .where(inArray(leases.status, ["active", "notice"]))
    .orderBy(units.code);
}

/** The landlord's name and contact, for the app shell. */
export async function getLandlordProfile(landlordId: string) {
  const [row] = await getDatabase()
    .select({ name: landlord.name, email: landlord.email, phone: landlord.phone, twoFactorEnabled: landlord.twoFactorEnabled })
    .from(landlord)
    .where(eq(landlord.id, landlordId));
  return row ?? null;
}

/** Every unit with its building, for pickers. */
export async function listUnitOptions() {
  return getDatabase()
    .select({ unitId: units.id, code: units.code, buildingId: units.buildingId, buildingName: buildings.name })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .orderBy(buildings.name, units.code);
}
