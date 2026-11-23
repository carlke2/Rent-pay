import type { Metadata } from "next";
import { Suspense } from "react";
import { FileText } from "lucide-react";
import { InvoiceGenerator } from "@/components/admin/invoice-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableSkeleton } from "@/components/shared/list-skeleton";
import { ListAnchor, Pagination, paramsKey } from "@/components/shared/pagination";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableCell, TableRow } from "@/components/shared/ui/table";
import { listInvoices } from "@/services/billing";
import { currentPeriod, formatDate, formatPeriod, isBillingPeriod } from "@/utilities/dates";
import { sumShillings } from "@/utilities/money";
import { readPageRequest, slicePage, type SearchParams } from "@/utilities/pagination";
import type { InvoiceStatus } from "@/services/billing";
import { adminShellSummary } from "@/services/reports";

const STATUSES: { value: InvoiceStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "overdue", label: "Overdue" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Part paid" },
  { value: "paid", label: "Paid" },
];

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  const query = await searchParams;
  const period = typeof query.period === "string" && isBillingPeriod(query.period) ? query.period : currentPeriod();
  const buildingId = typeof query.building === "string" && query.building ? query.building : undefined;
  const status = STATUSES.find((option) => option.value && option.value === query.status)?.value || undefined;
  // Same list the sidebar shows: cached and shared with the layout, so no extra query.
  const { buildings } = await adminShellSummary();

  return (
    <>
      <PageHeader title="Invoices" description={formatPeriod(period)} />
      <InvoiceGenerator defaultPeriod={period} />
      <FilterBar
        fields={[
          { name: "period", label: "Month", type: "month", value: period },
          { name: "building", label: "Building", type: "select", value: buildingId, options: [{ value: "", label: "All buildings" }, ...buildings.map((building) => ({ value: building.id, label: building.name }))] },
          { name: "status", label: "Status", type: "select", value: status ?? "", options: STATUSES },
        ]}
      />
      <ListAnchor id="invoices-list">
        <Suspense key={paramsKey(query)} fallback={<TableSkeleton />}>
          <InvoiceRows period={period} buildingId={buildingId} status={status} params={query} />
        </Suspense>
      </ListAnchor>
    </>
  );
}

async function InvoiceRows({ period, buildingId, status, params }: { period: string; buildingId?: string; status?: InvoiceStatus; params: SearchParams }) {
  // Paid/open/status come from every line's allocations, so the month is worked out in full (one invoice per
  // lease) and the page of 25 is cut on the server. Totals cover every invoice that matches, not just this page.
  const all = (await listInvoices({ period, buildingId })).filter((row) => !status || row.status === status);
  const totals = { total: sumShillings(all.map((row) => row.total)), paid: sumShillings(all.map((row) => row.paid)), open: sumShillings(all.map((row) => row.open)) };
  const { rows: invoices, info } = slicePage(all, readPageRequest(params).page);
  return (
    <>
      {invoices.length === 0 ? (
        status ? (
          <EmptyState icon={FileText} title="No invoices match" description="Try another status or building." />
        ) : (
          <EmptyState icon={FileText} title={`No invoices for ${formatPeriod(period)}`} description="Use Generate invoices above to bill this month." />
        )
      ) : (
        <ResponsiveTable
          rows={invoices}
          rowKey={(row) => row.id}
          footer={
            <TableRow>
              <TableCell colSpan={3} className="font-medium">{all.length} invoices (all pages)</TableCell>
              <TableCell className="text-right"><Money amount={totals.total} /></TableCell>
              <TableCell className="text-right"><Money amount={totals.paid} /></TableCell>
              <TableCell className="text-right font-semibold"><Money amount={totals.open} /></TableCell>
              <TableCell />
            </TableRow>
          }
          columns={[
            { key: "number", header: "Invoice", primary: true, cell: (row) => `${row.number} · ${row.unitCode}` },
            { key: "issued", header: "Issued", cell: (row) => formatDate(row.issueDate) },
            { key: "due", header: "Due", cell: (row) => formatDate(row.dueDate) },
            { key: "total", header: "Total", align: "right", cell: (row) => <Money amount={row.total} /> },
            { key: "paid", header: "Paid", align: "right", cell: (row) => <Money amount={row.paid} /> },
            { key: "open", header: "Open", align: "right", cell: (row) => <Money amount={row.open} className="font-medium" /> },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
          ]}
        />
      )}
      {invoices.length > 0 ? <Pagination info={info} params={params} pathname="/admin/invoices" anchor="invoices-list" /> : null}
    </>
  );
}
