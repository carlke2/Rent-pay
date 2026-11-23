import type { Metadata } from "next";
import { ChartColumn, FileSpreadsheet, FileText } from "lucide-react";
import { ReportPaper } from "@/components/reports/report-paper";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { LinkTabs } from "@/components/shared/link-tabs";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/shared/ui/button";
import { buildReport, isReportSlug, readReportParameters, reportQuery, REPORTS, ReportNeedsInput, statementLeaseOptions } from "@/reports";
import { ReportTotalsError } from "@/reports/document";
import { adminShellSummary } from "@/services/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const query = await searchParams;
  const slug = isReportSlug(query.report) ? query.report : "payments-received";
  const report = REPORTS.find((item) => item.slug === slug)!;
  const parameters = readReportParameters(slug, query);
  const filters = report.filters as readonly string[];

  const [result, { buildings }, leaseOptions] = await Promise.all([
    buildReport(slug, parameters).then(
      (document) => ({ document, error: null }),
      (error: unknown) => {
        if (error instanceof ReportNeedsInput || error instanceof RangeError || error instanceof ReportTotalsError) return { document: null, error };
        throw error;
      },
    ),
    adminShellSummary(),
    filters.includes("lease") ? statementLeaseOptions() : Promise.resolve([]),
  ]);

  const fields: FilterField[] = [];
  if (filters.includes("lease"))
    fields.push({ name: "leaseId", label: "Tenant", type: "select", value: parameters.leaseId ?? "", options: [{ value: "", label: "Choose a tenant" }, ...leaseOptions.map((lease) => ({ value: lease.id, label: lease.label }))] });
  if (filters.includes("period")) fields.push({ name: "period", label: "Month", type: "month", value: parameters.period });
  if (filters.includes("from")) fields.push({ name: "from", label: "From", type: "date", value: parameters.from });
  if (filters.includes("to")) fields.push({ name: "to", label: "To", type: "date", value: parameters.to });
  if (filters.includes("year")) fields.push({ name: "year", label: "Year", type: "text", value: String(parameters.year) });
  if (filters.includes("building"))
    fields.push({ name: "buildingId", label: "Building", type: "select", value: parameters.buildingId ?? "", options: [{ value: "", label: "All buildings" }, ...buildings.map((building) => ({ value: building.id, label: building.name }))] });

  const exportQuery = reportQuery(slug, parameters);
  const document = result.document;

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          document ? (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={`/admin/print?${exportQuery}&auto=1`} target="_blank" rel="noopener" className="text-foreground no-underline">
                  <FileText /> Export PDF
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`/admin/reports/export?${exportQuery}`} className="text-foreground no-underline">
                  <FileSpreadsheet /> Excel
                </a>
              </Button>
            </>
          ) : undefined
        }
      />
      <LinkTabs label="Reports" active={slug} tabs={REPORTS.map((item) => ({ value: item.slug, label: item.label, href: `/admin/reports?report=${item.slug}` }))} />
      {fields.length ? <FilterBar hidden={{ report: slug }} fields={fields} /> : null}

      {document ? (
        <div className="-mx-4 overflow-hidden bg-zinc-200 px-0 py-4 sm:mx-0 sm:rounded-xl sm:p-6 dark:bg-zinc-900">
          <ReportPaper document={document} />
        </div>
      ) : (
        <EmptyState
          icon={ChartColumn}
          title={result.error instanceof ReportTotalsError ? "This report did not add up, so it was not shown" : result.error instanceof Error ? result.error.message : "Nothing to show"}
          description={result.error instanceof ReportTotalsError ? result.error.message : undefined}
        />
      )}
    </>
  );
}
