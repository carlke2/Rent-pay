import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Users } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/shared/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableSkeleton } from "@/components/shared/list-skeleton";
import { ListAnchor, Pagination, paramsKey } from "@/components/shared/pagination";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { avatarUrl } from "@/services/avatars";
import { listTenants, type TenantListFilter } from "@/services/tenancy";
import { readPageRequest, slicePage, type SearchParams } from "@/utilities/pagination";

export const metadata: Metadata = { title: "Tenants" };

const STATUSES: { value: TenantListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "notice", label: "On notice" },
  { value: "owing", label: "Owing" },
  { value: "ended", label: "Moved out" },
];

export default async function TenantsPage({ searchParams }: PageProps<"/admin/tenants">) {
  const params = await searchParams;
  const { search, status } = params;
  const query = typeof search === "string" ? search : "";
  const filter = STATUSES.find((option) => option.value === status)?.value ?? "all";

  return (
    <>
      <PageHeader
        title="Tenants"
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
      <ListAnchor id="tenants-list">
        <Suspense key={paramsKey(params)} fallback={<TableSkeleton />}>
          <TenantRows query={query} filter={filter} params={params} />
        </Suspense>
      </ListAnchor>
    </>
  );
}

async function TenantRows({ query, filter, params }: { query: string; filter: TenantListFilter; params: SearchParams }) {
  // Balances and status are worked out per tenant in one query; the page of 25 is cut on the server.
  const all = await listTenants({ search: query, status: filter });
  const { rows: tenants, info } = slicePage(all, readPageRequest(params).page);
  return (
    <>
      {tenants.length === 0 ? (
        <EmptyState icon={Users} title={query || filter !== "all" ? "No tenants match" : "No tenants yet"} description={query ? "Try another name, phone number or unit code." : undefined} />
      ) : (
        <ResponsiveTable
          rows={tenants}
          rowKey={(row) => row.tenantId}
          columns={[
            {
              key: "name",
              header: "Tenant",
              primary: true,
              cell: (row) => (
                <Link href={`/admin/tenants/${row.tenantId}`} className="inline-flex items-center gap-2.5 font-medium">
                  <Avatar name={row.fullName} src={avatarUrl(row.tenantId, row.avatarKey)} className="size-8 text-xs" />
                  {row.fullName}
                </Link>
              ),
            },
            { key: "phone", header: "Phone", cell: (row) => `0${row.phone.slice(3)}` },
            { key: "units", header: "Unit", cell: (row) => row.units ?? "–" },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.leaseStatus} label={row.leaseStatus === "ended" ? "Moved out" : undefined} /> },
            { key: "balance", header: "Balance", align: "right", cell: (row) => <Money amount={row.balance} balance /> },
          ]}
        />
      )}
      {tenants.length > 0 ? <Pagination info={info} params={params} pathname="/admin/tenants" anchor="tenants-list" /> : null}
    </>
  );
}
