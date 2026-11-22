import type { Metadata } from "next";
import { ChartColumn, Download } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { LinkTabs } from "@/components/shared/link-tabs";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { PrintPageButton } from "@/components/shared/print-page-button";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import { REPORT_NAMES, runReport, type ReportName } from "@/services/reports";
import { listBuildings } from "@/services/tenancy";
import { currentPeriod, firstDayOfPeriod, isBillingPeriod, isIsoDate, todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Reports" };

const TITLES: Record<ReportName, string> = {
  "collection-summary": "Collection",
  "arrears-aging": "Arrears aging",
  occupancy: "Occupancy",
  "income-and-expenses": "Income & expenses",
  "rental-income-for-tax": "Rental income (tax)",
  "payment-log": "Payment log",
  "deposit-register": "Deposits",
};

const MONEY_KEYS = new Set([
  "billed", "paid", "open", "waived", "current", "days1To30", "days31To60", "days61To90", "over90", "total", "rentLost", "income",
  "expenses", "net", "received", "deposits", "grossRent", "estimatedTax", "amount", "charged", "held", "applied", "refundDue", "refunded", "stillToRefund",
]);
const STATUS_KEYS = new Set(["status", "leaseStatus", "unitStatus", "matchStatus"]);
const HIDDEN_KEYS = new Set(["receiptVoided"]);

const humanise = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/(\d+)/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(/ To /g, "–")
    .trim();

function renderValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "–";
  if (MONEY_KEYS.has(key) && typeof value === "number") return <Money amount={value} />;
  if (STATUS_KEYS.has(key) && typeof value === "string") return <StatusBadge status={value} />;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const query = await searchParams;
  const report = REPORT_NAMES.find((name) => name === query.report) ?? "collection-summary";
  const today = todayInNairobi();
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : undefined);
  const date = (key: string) => (text(key) && isIsoDate(text(key) as string) ? text(key) : undefined);
  const parameters: Record<string, string | undefined> = {
    period: text("period") && isBillingPeriod(text("period") as string) ? text("period") : undefined,
    buildingId: text("buildingId") || undefined,
    from: date("from"),
    to: date("to"),
    date: date("date"),
    year: text("year") && /^\d{4}$/.test(text("year") as string) ? text("year") : undefined,
  };
  const [result, buildings] = await Promise.all([runReport(report, parameters), listBuildings()]);
  const buildingField: FilterField = {
    name: "buildingId",
    label: "Building",
    type: "select",
    value: parameters.buildingId,
    options: [{ value: "", label: "All buildings" }, ...buildings.map((building) => ({ value: building.id, label: building.name }))],
  };
  const filters: Record<ReportName, FilterField[]> = {
    "collection-summary": [{ name: "period", label: "Month", type: "month", value: parameters.period ?? currentPeriod() }, buildingField],
    "arrears-aging": [{ name: "date", label: "As of", type: "date", value: parameters.date ?? today }, buildingField],
    occupancy: [
      { name: "from", label: "From", type: "date", value: parameters.from ?? firstDayOfPeriod(currentPeriod()) },
      { name: "to", label: "To", type: "date", value: parameters.to ?? today },
    ],
    "income-and-expenses": [
      { name: "from", label: "From", type: "date", value: parameters.from ?? `${today.slice(0, 4)}-01-01` },
      { name: "to", label: "To", type: "date", value: parameters.to ?? today },
      buildingField,
    ],
    "rental-income-for-tax": [{ name: "year", label: "Year", type: "text", value: parameters.year ?? today.slice(0, 4) }],
    "payment-log": [
      { name: "from", label: "From", type: "date", value: parameters.from ?? firstDayOfPeriod(currentPeriod()) },
      { name: "to", label: "To", type: "date", value: parameters.to ?? today },
    ],
    "deposit-register": [],
  };
  const rows = result.rows;
  const keys = rows[0] ? Object.keys(rows[0]).filter((key) => !HIDDEN_KEYS.has(key)) : [];
  const exportQuery = new URLSearchParams(
    Object.entries({ report: report as string, ...parameters }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const totals = result.totals ? Object.entries(result.totals) : [];

  return (
    <>
      <PageHeader
        title={TITLES[report]}
        description={report === "rental-income-for-tax" ? `Estimated Monthly Rental Income tax at ${String(result.taxRatePercent)}%. Check the current KRA rate before filing.` : undefined}
        actions={
          <>
            <PrintPageButton />
            <Button asChild size="sm" variant="outline">
              <a href={`/admin/reports/export?${exportQuery.toString()}`} className="text-foreground no-underline">
                <Download /> CSV
              </a>
            </Button>
          </>
        }
      />
      <LinkTabs label="Reports" active={report} tabs={REPORT_NAMES.map((name) => ({ value: name, label: TITLES[name], href: `/admin/reports?report=${name}` }))} />
      {filters[report].length ? <FilterBar hidden={{ report }} fields={filters[report]} /> : null}

      {totals.length ? (
        <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {totals.map(([key, value]) => (
            <div key={key} className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">{humanise(key)}</p>
              <p className="numbers font-semibold">{MONEY_KEYS.has(key) && typeof value === "number" ? <Money amount={value} /> : key.endsWith("Rate") ? `${value ?? "–"}%` : String(value ?? "–")}</p>
            </div>
          ))}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon={ChartColumn} title="Nothing to show for these filters" />
      ) : (
        <ResponsiveTable
          rows={rows}
          rowKey={(row) => JSON.stringify(row)}
          columns={keys.map((key, index) => ({
            key,
            header: humanise(key),
            primary: index === 0,
            align: MONEY_KEYS.has(key) || typeof rows[0]?.[key] === "number" ? ("right" as const) : ("left" as const),
            cell: (row: Record<string, unknown>) => renderValue(key, row[key]),
          }))}
        />
      )}
    </>
  );
}
