import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { TableSkeleton } from "@/components/shared/list-skeleton";
import { Money } from "@/components/shared/money";
import { ListAnchor, Pagination, paramsKey } from "@/components/shared/pagination";
import { StatusBadge } from "@/components/shared/status-badge";
import { TenantHeading } from "@/components/tenants/tenant-heading";
import { pageTenantReceipts } from "@/services/portal";
import { formatNairobiDateTime } from "@/utilities/dates";
import { readPageRequest, type SearchParams } from "@/utilities/pagination";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Receipts" };

type Lease = NonNullable<Awaited<ReturnType<typeof currentTenantLease>>["lease"]>;

export default async function ReceiptsPage({ searchParams }: PageProps<"/tenants/receipts">) {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const params = await searchParams;
  return (
    <>
      <TenantHeading title="Receipts" />
      <ListAnchor id="receipts-list">
        <Suspense key={paramsKey(params)} fallback={<TableSkeleton rows={6} />}>
          <ReceiptRows lease={lease} params={params} />
        </Suspense>
      </ListAnchor>
    </>
  );
}

async function ReceiptRows({ lease, params }: { lease: Lease; params: SearchParams }) {
  const page = await pageTenantReceipts(lease, readPageRequest(params));
  const receipts = page.rows;
  return (
    <>
      {receipts.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No receipts yet" description="Every payment you make gets a receipt here." />
      ) : (
        <ul className="grid gap-2">
          {receipts.map((receipt) => (
            <li key={receipt.paymentId}>
              <Link prefetch={false} href={`/receipts/${receipt.receiptToken}`} className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-foreground no-underline hover:bg-surface-muted">
                <div className="flex-1">
                  <Money amount={receipt.amount} className="font-semibold text-heading" />
                  <p className="text-sm text-muted-foreground">{formatNairobiDateTime(receipt.paidAt)}</p>
                  <p className="text-sm text-muted-foreground">{receipt.mpesaReceipt ? `M-Pesa ${receipt.mpesaReceipt}` : `${receipt.channel === "cash" ? "Cash" : "Bank"}${receipt.reference ? ` · ${receipt.reference}` : ""}`}</p>
                </div>
                {receipt.voided ? <StatusBadge status="void" /> : null}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {receipts.length > 0 ? <Pagination info={page.info} params={params} pathname="/tenants/receipts" anchor="receipts-list" /> : null}
    </>
  );
}
