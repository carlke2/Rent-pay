import "server-only";
import { sql } from "drizzle-orm";
import { currentPeriod, firstDayOfPeriod, isBillingPeriod, isIsoDate, lastDayOfPeriod, periodOf, todayInNairobi, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { arrearsByAge } from "./builders/arrears";
import { query } from "./builders/common";
import { incomeAndExpenses } from "./builders/income-expenses";
import { depositsReport, occupancyReport, rentalIncomeTaxReport } from "./builders/other";
import { paymentsReceived } from "./builders/payments-received";
import { rentRoll } from "./builders/rent-roll";
import { tenantStatement } from "./builders/tenant-statement";
import type { ReportDocument } from "./document";

export const REPORTS = [
  { slug: "payments-received", label: "Payments received", filters: ["period", "building"] },
  { slug: "tenant-statement", label: "Tenant statement", filters: ["lease", "from", "to"] },
  { slug: "rent-roll", label: "Rent roll", filters: ["period", "building"] },
  { slug: "arrears", label: "Arrears by age", filters: ["building"] },
  { slug: "income-expenses", label: "Income & expenses", filters: ["from", "to", "building"] },
  { slug: "occupancy", label: "Occupancy", filters: ["from", "to"] },
  { slug: "rental-income-tax", label: "Rental income (tax)", filters: ["year"] },
  { slug: "deposits", label: "Deposits", filters: ["none"] },
] as const;
export type ReportSlug = (typeof REPORTS)[number]["slug"];
export type ReportFilter = (typeof REPORTS)[number]["filters"][number];

export function isReportSlug(value: unknown): value is ReportSlug {
  return REPORTS.some((report) => report.slug === value);
}

/** Parameters from a URL, validated, with each report's defaults filled in. */
export type ReportParameters = { period: BillingPeriod; buildingId: string | null; leaseId: string | null; from: IsoDate; to: IsoDate; year: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readReportParameters(slug: ReportSlug, raw: Record<string, string | string[] | undefined>): ReportParameters {
  const value = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const today = todayInNairobi();
  const period = isBillingPeriod(value("period")) ? (value("period") as BillingPeriod) : currentPeriod();
  const monthEnd = lastDayOfPeriod(period) < today ? lastDayOfPeriod(period) : today;
  const defaultFrom = slug === "occupancy" ? firstDayOfPeriod(periodOf(today)) : firstDayOfPeriod(period);
  const defaultTo = slug === "occupancy" ? today : slug === "income-expenses" || slug === "tenant-statement" ? monthEnd : today;
  const from = isIsoDate(value("from")) ? (value("from") as IsoDate) : defaultFrom;
  const to = isIsoDate(value("to")) ? (value("to") as IsoDate) : defaultTo < from ? from : defaultTo;
  const year = /^\d{4}$/.test(value("year")) ? Number(value("year")) : Number(today.slice(0, 4));
  return {
    period,
    buildingId: UUID.test(value("buildingId")) ? value("buildingId") : null,
    leaseId: UUID.test(value("leaseId")) ? value("leaseId") : null,
    from,
    to,
    year,
  };
}

/** The query string that reproduces a report (used by the export links). */
export function reportQuery(slug: ReportSlug, parameters: ReportParameters): string {
  const filters = REPORTS.find((report) => report.slug === slug)!.filters as readonly string[];
  const entries: [string, string][] = [["report", slug]];
  if (filters.includes("period")) entries.push(["period", parameters.period]);
  if (filters.includes("building") && parameters.buildingId) entries.push(["buildingId", parameters.buildingId]);
  if (filters.includes("lease") && parameters.leaseId) entries.push(["leaseId", parameters.leaseId]);
  if (filters.includes("from")) entries.push(["from", parameters.from]);
  if (filters.includes("to")) entries.push(["to", parameters.to]);
  if (filters.includes("year")) entries.push(["year", String(parameters.year)]);
  return new URLSearchParams(entries).toString();
}

export class ReportNeedsInput extends Error {}

export async function buildReport(slug: ReportSlug, parameters: ReportParameters): Promise<ReportDocument> {
  switch (slug) {
    case "payments-received":
      return paymentsReceived({ period: parameters.period, buildingId: parameters.buildingId });
    case "tenant-statement":
      if (!parameters.leaseId) throw new ReportNeedsInput("Choose a tenant to see their statement.");
      return tenantStatement({ leaseId: parameters.leaseId, from: parameters.from, to: parameters.to });
    case "rent-roll":
      return rentRoll({ period: parameters.period, buildingId: parameters.buildingId });
    case "arrears":
      return arrearsByAge({ buildingId: parameters.buildingId });
    case "income-expenses":
      return incomeAndExpenses({ from: parameters.from, to: parameters.to, buildingId: parameters.buildingId });
    case "occupancy":
      return occupancyReport({ from: parameters.from, to: parameters.to });
    case "rental-income-tax":
      return rentalIncomeTaxReport({ year: parameters.year });
    case "deposits":
      return depositsReport();
  }
}

/** Tenancies to pick a statement for: current ones first, then past ones. */
export async function statementLeaseOptions() {
  return query<{ id: string; label: string }>(sql`
    select l.id, t.full_name || ' · ' || u.code || case when l.status = 'ended' then ' (moved out)' else '' end as label
    from leases l join tenants t on t.id = l.tenant_id join units u on u.id = l.unit_id
    order by l.status = 'ended', u.code, l.start_date desc`);
}
