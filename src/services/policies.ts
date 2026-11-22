import "server-only";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { waterCharge } from "@/core/billing";
import { mergePolicySettings, resolvePolicy, type PolicyRecord, type PolicySettings, type ResolvedPolicy } from "@/core/policy";
import { getDatabase, type Executor } from "@/database/client";
import { auditLog, buildings, leases, meterReadings, policies, units } from "@/database/schema";
import { assertIsoDate, periodOf, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { sumShillings } from "@/utilities/money";
import { BillingError, computePenaltyCandidates } from "./billing";

async function loadPolicyRows(database: Executor, buildingId?: string | null): Promise<PolicyRecord[]> {
  const scope =
    buildingId === undefined
      ? undefined
      : buildingId === null
        ? isNull(policies.buildingId)
        : or(isNull(policies.buildingId), eq(policies.buildingId, buildingId));
  return database
    .select({ id: policies.id, buildingId: policies.buildingId, effectiveFrom: policies.effectiveFrom, settings: policies.settings })
    .from(policies)
    .where(scope)
    .orderBy(asc(policies.createdAt));
}

/**
 * The settings that apply to a building on a date: building override over account level,
 * latest effective_from on or before the date, defaults for anything missing.
 */
export async function getPolicy(
  buildingId: string | null,
  date: IsoDate = todayInNairobi(),
  database: Executor = getDatabase(),
): Promise<ResolvedPolicy> {
  return resolvePolicy(await loadPolicyRows(database, buildingId), { buildingId, onDate: assertIsoDate(date) });
}

/** Loads every policy once and resolves in memory; for jobs that touch many leases. */
export async function loadPolicyResolver(
  database: Executor = getDatabase(),
): Promise<(buildingId: string | null, date: IsoDate) => ResolvedPolicy> {
  const rows = await loadPolicyRows(database);
  return (buildingId, date) => resolvePolicy(rows, { buildingId, onDate: date });
}

/**
 * Saves a policy as a new row (policies are never edited, so past invoices keep their rules).
 * `settings` may be partial: it is applied on top of what currently applies to that scope, then validated.
 */
export async function savePolicy(input: {
  buildingId: string | null;
  effectiveFrom: IsoDate;
  settings: unknown;
  actor: string;
  today?: IsoDate;
}): Promise<{ policyId: string; effectiveFrom: IsoDate; settings: PolicySettings }> {
  const today = input.today ?? todayInNairobi();
  const effectiveFrom = assertIsoDate(input.effectiveFrom);
  if (effectiveFrom < today) throw new BillingError(`effectiveFrom must be today (${today}) or later`);

  const database = getDatabase();
  if (input.buildingId) {
    const [building] = await database.select({ id: buildings.id }).from(buildings).where(eq(buildings.id, input.buildingId));
    if (!building) throw new BillingError("Building not found");
  }

  const current = await getPolicy(input.buildingId, effectiveFrom, database);
  const settings = mergePolicySettings(current.settings, input.settings);

  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .insert(policies)
      .values({ buildingId: input.buildingId, effectiveFrom, settings, createdBy: input.actor })
      .returning({ id: policies.id });
    if (!row) throw new Error("Policy insert returned no row");

    await transaction.insert(auditLog).values({
      actor: input.actor,
      action: "policy.save",
      entity: "policy",
      entityId: row.id,
      before: { policyId: current.policyId, source: current.source, settings: current.settings },
      after: { buildingId: input.buildingId, effectiveFrom, settings },
    });
    return { policyId: row.id, effectiveFrom, settings };
  });
}

/**
 * What a policy change would do to the current period, without saving anything:
 * penalties (leases and total), water charges for readings already entered this period,
 * and fixed charges per invoice.
 */
export async function previewPolicyChange(input: { buildingId: string | null; settings: unknown; today?: IsoDate }) {
  const today = input.today ?? todayInNairobi();
  const database = getDatabase();
  const resolver = await loadPolicyResolver(database);
  const scopeCurrent = input.buildingId ? resolver(input.buildingId, today) : resolver(null, today);
  const proposed = mergePolicySettings(scopeCurrent.settings, input.settings);

  // Which buildings the change reaches: the building itself, or (account level) every building without its own policy.
  const allBuildings = await database.select({ id: buildings.id }).from(buildings);
  const affectedBuildingIds = input.buildingId
    ? allBuildings.filter((building) => building.id === input.buildingId).map((building) => building.id)
    : allBuildings.filter((building) => resolver(building.id, today).source !== "building").map((building) => building.id);
  if (input.buildingId && affectedBuildingIds.length === 0) throw new BillingError("Building not found");
  const affected = new Set(affectedBuildingIds);

  // Penalties under current vs proposed rules.
  const leaseRows = affectedBuildingIds.length
    ? await database
        .select({ leaseId: leases.id })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(inArray(units.buildingId, affectedBuildingIds))
    : [];
  const leaseIds = leaseRows.map((row) => row.leaseId);
  const [currentPenalties, proposedPenalties] = await Promise.all([
    computePenaltyCandidates(database, { today, leaseIds, settingsFor: (buildingId) => resolver(buildingId, today).settings }),
    computePenaltyCandidates(database, {
      today,
      leaseIds,
      settingsFor: (buildingId) => (affected.has(buildingId) ? proposed : resolver(buildingId, today).settings),
    }),
  ]);
  const summarise = (candidates: Awaited<ReturnType<typeof computePenaltyCandidates>>) => {
    const charged = candidates.filter((candidate) => candidate.decision.apply);
    return {
      leases: charged.length,
      total: sumShillings(charged.map((candidate) => (candidate.decision.apply ? candidate.decision.amount : 0))),
    };
  };

  // Water for readings already entered this period (they are billed on next period's invoice).
  const period = periodOf(today);
  const readings = affectedBuildingIds.length
    ? await database
        .select({
          unitCode: units.code,
          buildingId: units.buildingId,
          previousReading: meterReadings.previousReading,
          currentReading: meterReadings.currentReading,
        })
        .from(meterReadings)
        .innerJoin(units, eq(units.id, meterReadings.unitId))
        .where(and(eq(meterReadings.period, period), eq(meterReadings.kind, "regular"), inArray(units.buildingId, affectedBuildingIds)))
    : [];
  const water = readings.map((reading) => {
    const consumption = Math.max(0, reading.currentReading - reading.previousReading);
    const before = waterCharge({ consumption, ...resolver(reading.buildingId, today).settings.water }).total;
    const after = waterCharge({ consumption, ...proposed.water }).total;
    return { unitCode: reading.unitCode, consumption, current: before, proposed: after, change: after - before };
  });

  const fixedTotal = (settings: PolicySettings) => sumShillings(settings.fixedCharges.map((charge) => charge.amount));
  const currentFixed = fixedTotal(scopeCurrent.settings);
  const proposedFixed = fixedTotal(proposed);

  const penaltiesNow = summarise(currentPenalties);
  const penaltiesProposed = summarise(proposedPenalties);
  const waterNow = sumShillings(water.map((item) => item.current));
  const waterProposed = sumShillings(water.map((item) => item.proposed));

  return {
    today,
    period,
    scope: input.buildingId ? "building" : "account",
    buildingsAffected: affectedBuildingIds.length,
    leasesInScope: leaseIds.length,
    proposedSettings: proposed,
    penalties: {
      current: penaltiesNow,
      proposed: penaltiesProposed,
      change: { leases: penaltiesProposed.leases - penaltiesNow.leases, total: penaltiesProposed.total - penaltiesNow.total },
    },
    water: { period, readings: water, currentTotal: waterNow, proposedTotal: waterProposed, change: waterProposed - waterNow },
    fixedChargesPerInvoice: { current: currentFixed, proposed: proposedFixed, change: proposedFixed - currentFixed },
  };
}

/** Every saved policy, newest first, with its scope (for the change history). */
export async function listPolicyHistory() {
  return getDatabase()
    .select({
      id: policies.id,
      buildingId: policies.buildingId,
      buildingName: buildings.name,
      effectiveFrom: policies.effectiveFrom,
      createdBy: policies.createdBy,
      createdAt: policies.createdAt,
      settings: policies.settings,
    })
    .from(policies)
    .leftJoin(buildings, eq(buildings.id, policies.buildingId))
    .orderBy(desc(policies.createdAt));
}
