import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { Button } from "@/components/shared/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { listTenants, type TenantListFilter } from "@/services/tenancy";

export const metadata: Metadata = { title: "Tenants" };

const STATUSES: { value: TenantListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "notice", label: "On notice" },
  { value: "owing", label: "Owing" },
  { value: "ended", label: "Moved out" },
];

export default async function TenantsPage({ searchParams }: PageProps<"/admin/tenants">) {
  const { search, status } = await searchParams;
  const query = typeof search === "string" ? search : "";
  const filter = STATUSES.find((option) => option.value === status)?.value ?? "all";
  const tenants = await listTenants({ search: query, status: filter });

  return (
    <>
      <PageHeader
        title="Tenants"
        description={`${tenants.length} shown`}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/move-in" className="no-underline">Move in a tenant</Link>
          </Button>
        }
      />
      <FilterBar
        fields={[
          { name: "search", label: "Search", type: "search", value: query, placeholder: "Name, phone or unit" },
          { name: "status", label: "Status", type: "select", value: filter, options: STATUSES },
        ]}
      />
      {tenants.length === 0 ? (
        <EmptyState icon={Users} title={query || filter !== "all" ? "No tenants match" : "No tenants yet"} description={query ? "Try another name, phone number or unit code." : undefined} />
      ) : (
        <ResponsiveTable
          rows={tenants}
          rowKey={(row) => row.tenantId}
          columns={[
            { key: "name", header: "Tenant", primary: true, cell: (row) => <Link href={`/admin/tenants/${row.tenantId}`} className="font-medium">{row.fullName}</Link> },
            { key: "phone", header: "Phone", cell: (row) => `0${row.phone.slice(3)}` },
            { key: "units", header: "Unit", cell: (row) => row.units ?? "–" },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.leaseStatus} label={row.leaseStatus === "ended" ? "Moved out" : undefined} /> },
            { key: "balance", header: "Balance", align: "right", cell: (row) => <Money amount={row.balance} balance /> },
          ]}
        />
      )}
    </>
  );
}
