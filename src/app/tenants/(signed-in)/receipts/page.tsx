import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { TenantHeading } from "@/components/tenants/tenant-heading";
import { listTenantReceipts } from "@/services/portal";
import { formatNairobiDateTime } from "@/utilities/dates";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage() {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const receipts = await listTenantReceipts(lease);
  return (
    <>
      <TenantHeading title="Receipts" />
      {receipts.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No receipts yet" description="Every payment you make gets a receipt here." />
      ) : (
        <ul className="grid gap-2">
          {receipts.map((receipt) => (
            <li key={receipt.paymentId}>
              <Link href={`/receipts/${receipt.receiptToken}`} className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-foreground no-underline hover:bg-surface-muted">
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
    </>
  );
}
