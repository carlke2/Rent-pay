import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/list-skeleton";
import { Money } from "@/components/shared/money";
import { ListAnchor, Pagination, paramsKey } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { TenantHeading } from "@/components/tenants/tenant-heading";
import { listTenantBills } from "@/services/portal";
import { formatDate, formatPeriod } from "@/utilities/dates";
import { readPageRequest, slicePage, type SearchParams } from "@/utilities/pagination";
import { currentTenantLease } from "../../../current-lease";

export const metadata: Metadata = { title: "Bills" };

type Lease = NonNullable<Awaited<ReturnType<typeof currentTenantLease>>["lease"]>;

export default async function BillsPage({ searchParams }: PageProps<"/tenants/bills">) {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const params = await searchParams;
  return (
    <>
      <TenantHeading title="Bills" description="Newest first. Tap a bill to see what's in it." />
      <ListAnchor id="bills-list">
        <Suspense key={paramsKey(params)} fallback={<TableSkeleton rows={6} />}>
          <BillRows lease={lease} params={params} />
        </Suspense>
      </ListAnchor>
    </>
  );
}

async function BillRows({ lease, params }: { lease: Lease; params: SearchParams }) {
  // A bill's status depends on its allocations, so the lease's bills are worked out together; the page is cut on the server.
  const { rows: bills, info } = slicePage(await listTenantBills(lease), readPageRequest(params).page);
  return (
    <>
      {bills.length === 0 ? (
        <EmptyState icon={FileText} title="No bills yet" description="Your first bill appears here once your landlord sends it." />
      ) : (
        <ul className="grid gap-2">
          {bills.map((bill) => (
            <li key={bill.invoiceId}>
              <Link href={`/tenants/bills/${bill.invoiceId}`} className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-foreground no-underline hover:bg-surface-muted">
                <div className="flex-1">
                  <p className="font-semibold text-heading">{formatPeriod(bill.period)}</p>
                  <p className="text-sm text-muted-foreground">Due {formatDate(bill.dueDate)}</p>
                </div>
                <div className="grid justify-items-end gap-1">
                  <Money amount={bill.total} className="font-semibold" />
                  {bill.open > 0 && bill.open !== bill.total ? (
                    <span className="text-xs text-muted-foreground">
                      <Money amount={bill.open} /> open
                    </span>
                  ) : null}
                  <StatusBadge status={bill.status} />
                </div>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {bills.length > 0 ? <Pagination info={info} params={params} pathname="/tenants/bills" anchor="bills-list" /> : null}
    </>
  );
}
