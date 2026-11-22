import type { Metadata } from "next";
import { Banknote } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReportPaymentForm } from "@/components/tenants/report-payment-form";
import { TenantCard, TenantHeading } from "@/components/tenants/tenant-heading";
import { listPaymentClaims } from "@/services/payments";
import { getBankDetails } from "@/services/portal";
import { formatDate, todayInNairobi } from "@/utilities/dates";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Report a payment" };

export default async function ReportPaymentPage() {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const bank = getBankDetails();
  const claims = await listPaymentClaims({ leaseId: lease.leaseId, status: "all" });

  return (
    <div className="grid gap-4">
      <TenantHeading title="Report a payment" description="Paid by bank or cash? Tell your landlord here and they'll confirm it." back="/tenants/more" />

      {bank ? (
        <TenantCard>
          <h2 className="font-semibold text-heading">Bank details</h2>
          <dl className="mt-2 grid gap-1.5 text-sm">
            {bank.bankName ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Bank</dt><dd className="font-medium">{bank.bankName}{bank.branch ? `, ${bank.branch}` : ""}</dd></div> : null}
            {bank.accountName ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Account name</dt><dd className="font-medium">{bank.accountName}</dd></div> : null}
          </dl>
          {bank.accountNumber ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3.5 py-2">
              <div>
                <p className="text-xs text-muted-foreground">Account number</p>
                <p className="text-xl font-semibold text-heading">{bank.accountNumber}</p>
              </div>
              <CopyButton value={bank.accountNumber} label="Account number" />
            </div>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">Use {lease.unitCode} as the reference.</p>
        </TenantCard>
      ) : null}

      <TenantCard>
        <ReportPaymentForm today={todayInNairobi()} />
      </TenantCard>

      <section>
        <h2 className="mb-2 font-semibold text-heading">Your reports</h2>
        {claims.length === 0 ? (
          <EmptyState icon={Banknote} title="Nothing reported yet" />
        ) : (
          <ul className="grid gap-2">
            {claims.map((claim) => (
              <li key={claim.id} className="rounded-2xl border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Money amount={claim.amount} className="font-semibold text-heading" />
                  <StatusBadge status={claim.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {claim.method === "cash" ? "Cash" : claim.method === "mpesa" ? "M-Pesa" : "Bank"} · paid {formatDate(claim.paidOn)}
                  {claim.reference ? ` · ${claim.reference}` : ""}
                </p>
                {claim.status === "rejected" && claim.reason ? <p className="mt-1 text-sm text-status-overdue">Reason: {claim.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
