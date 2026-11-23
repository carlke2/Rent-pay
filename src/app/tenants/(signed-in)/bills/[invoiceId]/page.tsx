import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Money } from "@/components/shared/money";
import { TenantCard, TenantHeading } from "@/components/tenants/tenant-heading";
import { getTenantBill } from "@/services/portal";
import { formatDate, formatNairobiDateTime, formatPeriod } from "@/utilities/dates";
import { currentTenantLease } from "../../../current-lease";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params }: PageProps<"/tenants/bills/[invoiceId]">) {
  const { invoiceId } = await params;
  const { lease } = await currentTenantLease();
  if (!lease || !/^[0-9a-f-]{36}$/.test(invoiceId)) notFound();
  const bill = await getTenantBill(lease, invoiceId);
  if (!bill) notFound();

  return (
    <div className="grid gap-4">
      <TenantHeading title={formatPeriod(bill.invoice.period)} description={`${bill.invoice.number} · due ${formatDate(bill.invoice.dueDate)}`} back="/tenants/bills" />

      <TenantCard>
        <ul className="divide-y divide-border">
          {bill.lines.map((line) => (
            <li key={line.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex justify-between gap-3">
                <span className="font-medium text-heading">{line.description}</span>
                <Money amount={line.amount} className="font-medium" />
              </div>
              {line.type === "water" && line.quantity > 1 ? (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {bill.waterReading ? `Meter ${bill.waterReading.previousReading} → ${bill.waterReading.currentReading}, ` : ""}
                  {line.quantity} units × KES {line.rate.toLocaleString("en-KE")}
                </p>
              ) : null}
              {line.waived > 0 ? (
                <p className="mt-0.5 flex justify-between text-sm text-status-paid">
                  <span>Waived by landlord</span>
                  <span>
                    −<Money amount={line.waived} />
                  </span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 border-t border-border pt-3 text-sm">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right"><Money amount={bill.total} /></dd>
          {bill.waived ? (
            <>
              <dt className="text-muted-foreground">Waived</dt>
              <dd className="text-right text-status-paid">−<Money amount={bill.waived} /></dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-right">−<Money amount={bill.paid} /></dd>
          <dt className="font-semibold text-heading">Still to pay</dt>
          <dd className="text-right text-lg font-semibold text-heading"><Money amount={bill.open} /></dd>
        </dl>
      </TenantCard>

      <TenantCard>
        <h2 className="font-semibold text-heading">Paid towards this bill</h2>
        {bill.paidBy.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {bill.paidBy.map((payment) => (
              <li key={payment.paymentId} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {formatNairobiDateTime(payment.paidAt)}
                  {payment.receiptToken ? (
                    <>
                      {" · "}
                      <Link prefetch={false} href={`/receipts/${payment.receiptToken}`}>{payment.receiptNumber}</Link>
                    </>
                  ) : null}
                </span>
                <Money amount={payment.amount} className="font-medium" />
              </li>
            ))}
          </ul>
        )}
      </TenantCard>
    </div>
  );
}
