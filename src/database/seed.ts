import "server-only";
/**
 * Development seed: landlord from .env, 20 units across 2 buildings, 20 tenants with active leases,
 * account policy, opening meter readings, and invoices for the current period.
 * Safe to re-run: tops up anything missing and refreshes the landlord login.
 */
import { hashPassword } from "@/authentication/password";
import { DEFAULT_POLICY_SETTINGS } from "@/core/policy";
import { asc, count, eq, isNull } from "drizzle-orm";
import { addMonthsToPeriod, currentPeriod, firstDayOfPeriod, lastDayOfPeriod } from "@/utilities/dates";
import { getEnvironment } from "@/configuration/environment";
import { closeDatabase, getDatabase } from "./client";
import { buildings, invoices, landlord, leases, meterReadings, policies, tenants, units } from "./schema";
import { generateInvoices } from "@/services/billing";

const TARGET_UNITS = 20;
const TARGET_TENANTS = 20;

const SEED_POLICY_SETTINGS = {
  ...DEFAULT_POLICY_SETTINGS,
  water: { ratePerUnit: 150, standingCharge: 0 },
  fixedCharges: [{ name: "Garbage", amount: 300 }],
};

const UNIT_TYPES = ["Bedsitter", "Studio", "One bedroom", "Two bedroom"] as const;

const TENANT_NAMES = [
  "Wanjiru Kamau",
  "Otieno Ochieng",
  "Amina Hassan",
  "Caleb Salat",
  "Njeri Wambui",
  "Brian Odhiambo",
  "Fatuma Ali",
  "Daniel Mwangi",
  "Grace Chebet",
  "Samuel Kariuki",
  "Mercy Akinyi",
  "Hassan Mohamed",
  "Lucy Njoki",
  "Peter Kimani",
  "Joyce Atieno",
  "Eric Kiptoo",
  "Faith Wanjala",
  "George Mutua",
  "Sharon Cherono",
  "James Otieno",
];

async function seed() {
  const environment = getEnvironment();
  if (environment.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

  const email = environment.SEED_LANDLORD_EMAIL;
  const password = environment.SEED_LANDLORD_PASSWORD;
  if (!email || !password) throw new Error("Set SEED_LANDLORD_EMAIL and SEED_LANDLORD_PASSWORD in .env.");

  const leaseStart = firstDayOfPeriod(addMonthsToPeriod(currentPeriod(), -3));

  await ensureLandlord(email, password);
  const buildingIds = await ensureBuildings();
  await ensureUnits(buildingIds);
  await ensureTenantsAndLeases(leaseStart);
  await seedAccountPolicy(leaseStart);
  await seedOpeningReadings();
  await seedInvoices();

  const database = getDatabase();
  const [[buildingsCount], [unitsCount], [tenantsCount], [leasesCount], [readingsCount], [invoicesCount]] = await Promise.all([
    database.select({ value: count() }).from(buildings),
    database.select({ value: count() }).from(units),
    database.select({ value: count() }).from(tenants),
    database.select({ value: count() }).from(leases).where(eq(leases.status, "active")),
    database.select({ value: count() }).from(meterReadings),
    database.select({ value: count() }).from(invoices),
  ]);
  const summary = {
    buildings: buildingsCount?.value ?? 0,
    units: unitsCount?.value ?? 0,
    tenants: tenantsCount?.value ?? 0,
    leases: leasesCount?.value ?? 0,
    readings: readingsCount?.value ?? 0,
    invoices: invoicesCount?.value ?? 0,
  };
  console.log("Seed summary:", summary);
  console.log(`Admin login: ${email} (password from SEED_LANDLORD_PASSWORD).`);
  console.log("Tenant portal: SMS code to the phone (SMS_PROVIDER=console prints the code).");
  console.log("  1) Wanjiru Kamau — phone 0708 374 149 (254708374149) — unit KIL-A01");
  console.log("  2) Otieno Ochieng — phone 0711 000 002 (254711000002) — unit KIL-A02");
}

async function ensureLandlord(email: string, password: string) {
  const database = getDatabase();
  const [existing] = await database.select({ id: landlord.id }).from(landlord).limit(1);
  const passwordHash = await hashPassword(password);
  if (existing) {
    await database
      .update(landlord)
      .set({ email: email.toLowerCase(), passwordHash, twoFactorEnabled: false, phone: "254700000000" })
      .where(eq(landlord.id, existing.id));
    console.log(`Landlord refreshed: ${email} (2FA off).`);
    return;
  }
  await database.insert(landlord).values({
    name: "Demo Landlord",
    email: email.toLowerCase(),
    passwordHash,
    phone: "254700000000",
    twoFactorEnabled: false,
  });
  console.log(`Landlord created: ${email}.`);
}

async function ensureBuildings(): Promise<{ kilimaniId: string; westlandsId: string }> {
  const database = getDatabase();
  const existing = await database.select().from(buildings);
  let kilimani = existing.find((row) => row.codePrefix === "KIL");
  let westlands = existing.find((row) => row.codePrefix === "WES");

  if (!kilimani) {
    [kilimani] = await database
      .insert(buildings)
      .values({ name: "Kilimani Heights", location: "Kilimani, Nairobi", codePrefix: "KIL" })
      .returning();
  }
  if (!westlands) {
    [westlands] = await database
      .insert(buildings)
      .values({ name: "Westlands Court", location: "Westlands, Nairobi", codePrefix: "WES" })
      .returning();
  }
  if (!kilimani || !westlands) throw new Error("Could not ensure buildings.");
  console.log(`Buildings ready: ${kilimani.name}, ${westlands.name}.`);
  return { kilimaniId: kilimani.id, westlandsId: westlands.id };
}

/** Plans 20 unit codes: KIL-A01..A10 and WES-B01..B10. */
function plannedUnits(kilimaniId: string, westlandsId: string) {
  const rows: {
    buildingId: string;
    code: string;
    type: string;
    floor: number;
    rentAmount: number;
    depositAmount: number;
    meterNumber: string;
    status: "occupied";
  }[] = [];

  for (let index = 1; index <= 10; index++) {
    const rent = 12000 + (index % 4) * 4000;
    rows.push({
      buildingId: kilimaniId,
      code: `KIL-A${String(index).padStart(2, "0")}`,
      type: UNIT_TYPES[(index - 1) % UNIT_TYPES.length]!,
      floor: Math.floor((index - 1) / 4),
      rentAmount: rent,
      depositAmount: rent,
      meterNumber: `WM-1${String(index).padStart(3, "0")}`,
      status: "occupied",
    });
  }
  for (let index = 1; index <= 10; index++) {
    const rent = 15000 + (index % 4) * 5000;
    rows.push({
      buildingId: westlandsId,
      code: `WES-B${String(index).padStart(2, "0")}`,
      type: UNIT_TYPES[(index - 1) % UNIT_TYPES.length]!,
      floor: Math.floor((index - 1) / 4),
      rentAmount: rent,
      depositAmount: rent,
      meterNumber: `WM-2${String(index).padStart(3, "0")}`,
      status: "occupied",
    });
  }
  return rows;
}

async function ensureUnits(buildingIds: { kilimaniId: string; westlandsId: string }) {
  const database = getDatabase();
  const existing = await database.select({ id: units.id, code: units.code, status: units.status }).from(units);
  const byCode = new Map(existing.map((row) => [row.code, row]));
  const planned = plannedUnits(buildingIds.kilimaniId, buildingIds.westlandsId);

  const toInsert = planned.filter((row) => !byCode.has(row.code));
  if (toInsert.length > 0) {
    await database.insert(units).values(toInsert);
    console.log(`Added ${toInsert.length} units.`);
  }

  // Mark every planned unit occupied so each can take a tenant lease.
  const plannedCodes = planned.map((row) => row.code);
  for (const code of plannedCodes) {
    const row = byCode.get(code);
    if (row && row.status !== "occupied") {
      await database.update(units).set({ status: "occupied" }).where(eq(units.id, row.id));
    }
  }

  const [unitRow] = await database.select({ value: count() }).from(units);
  const unitCount = unitRow?.value ?? 0;
  if (unitCount < TARGET_UNITS) {
    throw new Error(`Expected at least ${TARGET_UNITS} units, have ${unitCount}.`);
  }
  console.log(`Units ready: ${unitCount}.`);
}

/** Phone for tenant index 0..19. Index 0 keeps the Daraja sandbox number; index 3 is Caleb. */
function tenantPhone(index: number): string {
  if (index === 0) return "254708374149";
  if (index === 3) return "254727845605";
  return `254711${String(index + 1).padStart(6, "0")}`;
}

async function ensureTenantsAndLeases(leaseStart: string) {
  const database = getDatabase();
  const existingTenants = await database.select({ id: tenants.id, phone: tenants.phone, fullName: tenants.fullName }).from(tenants);
  const byPhone = new Map(existingTenants.map((row) => [row.phone, row]));

  // Keep Caleb Salat on 0727845605 even if an older seed used a different phone/name.
  const calebPhone = tenantPhone(3);
  const [caleb] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.fullName, "Caleb Salat")).limit(1);
  if (caleb) {
    await database.update(tenants).set({ phone: calebPhone, portalAccess: true }).where(eq(tenants.id, caleb.id));
  }

  const tenantIds: string[] = [];
  for (let index = 0; index < TARGET_TENANTS; index++) {
    const phone = tenantPhone(index);
    const existing = byPhone.get(phone);
    if (existing) {
      if (index === 3) {
        await database.update(tenants).set({ fullName: "Caleb Salat", portalAccess: true }).where(eq(tenants.id, existing.id));
      }
      tenantIds.push(existing.id);
      continue;
    }
    const [created] = await database
      .insert(tenants)
      .values({
        fullName: TENANT_NAMES[index] ?? `Tenant ${index + 1}`,
        nationalId: String(12_000_000 + index),
        phone,
        portalAccess: true,
        whatsappOptIn: index % 3 === 0,
        ...(index === 0
          ? { nextOfKin: { name: "Peter Kamau", phone: "254711000001", relationship: "Brother" } }
          : {}),
      })
      .returning({ id: tenants.id });
    if (!created) throw new Error(`Failed to create tenant ${index + 1}`);
    tenantIds.push(created.id);
  }
  console.log(`Tenants ready: ${tenantIds.length}.`);

  const unitRows = await database
    .select({ id: units.id, code: units.code, rentAmount: units.rentAmount, depositAmount: units.depositAmount })
    .from(units)
    .orderBy(asc(units.code));

  // Prefer the planned 20 codes in order so phones map stably to units.
  const plannedCodes = [...plannedUnits("x", "y").map((row) => row.code)];
  const orderedUnits = plannedCodes
    .map((code) => unitRows.find((row) => row.code === code))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const currentLeases = await database
    .select({ unitId: leases.unitId, tenantId: leases.tenantId, status: leases.status })
    .from(leases)
    .where(eq(leases.status, "active"));
  const leasedUnitIds = new Set(currentLeases.map((row) => row.unitId));
  const leasedTenantIds = new Set(currentLeases.map((row) => row.tenantId));

  const leaseValues: {
    tenantId: string;
    unitId: string;
    startDate: string;
    rentAmount: number;
    depositAmount: number;
    status: "active";
  }[] = [];

  for (let index = 0; index < Math.min(TARGET_TENANTS, orderedUnits.length); index++) {
    const unit = orderedUnits[index]!;
    const tenantId = tenantIds[index]!;
    if (leasedUnitIds.has(unit.id) || leasedTenantIds.has(tenantId)) continue;
    leaseValues.push({
      tenantId,
      unitId: unit.id,
      startDate: leaseStart,
      rentAmount: unit.rentAmount,
      depositAmount: unit.depositAmount,
      status: "active",
    });
  }

  if (leaseValues.length > 0) {
    await database.insert(leases).values(leaseValues);
    console.log(`Added ${leaseValues.length} active leases.`);
  }

  const [activeRow] = await database.select({ value: count() }).from(leases).where(eq(leases.status, "active"));
  console.log(`Active leases: ${activeRow?.value ?? 0}.`);
}

async function seedAccountPolicy(leaseStart: string) {
  const database = getDatabase();
  const [first] = await database
    .select({ id: policies.id })
    .from(policies)
    .where(isNull(policies.buildingId))
    .orderBy(asc(policies.effectiveFrom), asc(policies.createdAt))
    .limit(1);
  if (first) {
    await database.update(policies).set({ settings: SEED_POLICY_SETTINGS }).where(eq(policies.id, first.id));
    console.log("Account policy: water 150/unit, Garbage 300.");
    return;
  }
  await database.insert(policies).values({ buildingId: null, effectiveFrom: leaseStart, settings: SEED_POLICY_SETTINGS, createdBy: "seed" });
  console.log("Account policy created: water 150/unit, Garbage 300.");
}

async function seedOpeningReadings() {
  const database = getDatabase();
  const period = addMonthsToPeriod(currentPeriod(), -1);
  const [allUnits, withReadings] = await Promise.all([
    database.select({ id: units.id, code: units.code }).from(units).orderBy(asc(units.code)),
    database.selectDistinct({ unitId: meterReadings.unitId }).from(meterReadings),
  ]);
  const hasReading = new Set(withReadings.map((row) => row.unitId));
  const missing = allUnits.filter((unit) => !hasReading.has(unit.id));
  if (missing.length === 0) {
    console.log("Opening meter readings already exist.");
    return;
  }
  await database.insert(meterReadings).values(
    missing.map((unit, index) => {
      const baseline = 1000 + index * 250;
      return {
        unitId: unit.id,
        period,
        previousReading: baseline,
        currentReading: baseline + 8 + (index % 5),
        readOn: lastDayOfPeriod(period),
        flagged: false,
        confirmed: true,
      };
    }),
  );
  console.log(`Opening meter readings for ${period}: ${missing.length} units.`);
}

async function seedInvoices() {
  const period = currentPeriod();
  const result = await generateInvoices({ period, dryRun: false });
  console.log(
    `Invoices for ${period}: created ${result.created}, skipped ${result.skipped}, missing readings ${result.missingReadings.length}.`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
