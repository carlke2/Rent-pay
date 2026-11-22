import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { InvoiceGenerator } from "@/components/admin/invoice-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableCell, TableRow } from "@/components/shared/ui/table";
import { listInvoices } from "@/services/billing";
import { listBuildings } from "@/services/tenancy";
import { currentPeriod, formatDate, formatPeriod, isBillingPeriod } from "@/utilities/dates";
import { sumShillings } from "@/utilities/money";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  const query = await searchParams;
  const period = typeof query.period === "string" && isBillingPeriod(query.period) ? query.period : currentPeriod();
  const buildingId = typeof query.building === "string" && query.building ? query.building : undefined;
  const [invoices, buildings] = await Promise.all([listInvoices({ period, buildingId }), listBuildings()]);
  const totals = { total: sumShillings(invoices.map((row) => row.total)), paid: sumShillings(invoices.map((row) => row.paid)), open: sumShillings(invoices.map((row) => row.open)) };

  return (
    <>
      <PageHeader title="Invoices" description={formatPeriod(period)} />
      <InvoiceGenerator defaultPeriod={period} />
      <FilterBar
        fields={[
          { name: "period", label: "Month", type: "month", value: period },
          { name: "building", label: "Building", type: "select", value: buildingId, options: [{ value: "", label: "All buildings" }, ...buildings.map((building) => ({ value: building.id, label: building.name }))] },
        ]}
      />
      {invoices.length === 0 ? (
        <EmptyState icon={FileText} title={`No invoices for ${formatPeriod(period)}`} description="Use Generate invoices above to bill this month." />
      ) : (
        <ResponsiveTable
          rows={invoices}
          rowKey={(row) => row.id}
          footer={
            <TableRow>
              <TableCell colSpan={3} className="font-medium">{invoices.length} invoices</TableCell>
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
    </>
  );
}
