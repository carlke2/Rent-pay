import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, ReceiptText, UploadCloud } from "lucide-react";
import { StatusBadge, statusSurfaceClass } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import { PaybillCard } from "@/components/tenants/paybill-card";
import { TenantPaymentsChart } from "@/components/tenants/payments-chart";
import { getTenantHome, getTenantTrend, listTenantBills, listTenantReceipts } from "@/services/portal";
import { cn } from "@/utilities/class-names";
import { formatDate, formatNairobiDateTime, formatPeriod } from "@/utilities/dates";
import { formatAmount, formatShillings, sumShillings } from "@/utilities/money";
import { currentTenantLease } from "../current-lease";

export const metadata: Metadata = { title: "Overview" };

const card = "rounded-[14px] border bg-card";

export default async function TenantOverviewPage() {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const [home, trend, bills, receipts] = await Promise.all([getTenantHome(lease), getTenantTrend(lease, 6), listTenantBills(lease), listTenantReceipts(lease)]);
  const owes = home.balance > 0;
  const paidRecently = sumShillings(trend.map((point) => point.paid));
  const openBills = bills.filter((bill) => bill.open > 0).length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-heading sm:text-[28px]">Hi {home.firstName}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {lease.unitCode} · {lease.buildingName}
            {lease.isCurrent ? "" : " · moved out"}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="px-4 text-foreground">
          <Link href="/tenants/statement" className="no-underline">
            Statement <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </div>

      <section aria-label="Your account" className="mb-6 grid grid-cols-1 gap-4">
        <div className="flex flex-col rounded-[14px] bg-primary p-5 text-primary-foreground">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-primary-foreground/60">{owes ? "Amount due" : home.balance < 0 ? "Credit" : "Balance"}</p>
            <span className="rounded-full bg-primary-foreground px-2.5 py-0.5 text-xs font-semibold text-primary">{home.status === "paid" ? "Paid up" : home.status === "overdue" ? "Overdue" : home.status === "partial" ? "Part paid" : owes ? "Due" : "Up to date"}</span>
          </div>
          <Amount value={Math.abs(home.balance)} className="mt-2 text-primary-foreground" />
          <p className="mt-2 text-xs text-primary-foreground/60">
            {owes ? `Due ${formatDate(home.dueDate)}` : home.balance < 0 ? "Goes towards your next bill" : `Next rent due ${formatDate(home.dueDate)}`}
          </p>
          {lease.isCurrent && owes ? (
            <Link
              href="/tenants/pay"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-lg bg-primary-foreground px-4 text-sm font-semibold text-primary no-underline hover:bg-primary-foreground/85 hover:text-primary"
            >
              Pay {formatShillings(home.balance)}
            </Link>
          ) : null}
        </div>

        <StatCard label="Monthly rent" value={<Amount value={lease.rentAmount} />} note={`Next due ${formatDate(home.dueDate)}`} />

        <StatCard
          label="Last payment"
          value={home.lastPayment ? <Amount value={home.lastPayment.amount} /> : <span className="numbers text-[28px] leading-none font-semibold tracking-[-0.02em] text-heading">–</span>}
          note={
            home.lastPayment ? (
              <>
                {formatNairobiDateTime(home.lastPayment.paidAt)}
                {home.lastPayment.receiptToken ? (
                  <>
                    {" · "}
                    <Link href={`/receipts/${home.lastPayment.receiptToken}`} target="_blank" rel="noreferrer">
                      Receipt
                    </Link>
                  </>
                ) : null}
              </>
            ) : (
              "No payments yet"
            )
          }
        />

        <StatCard
          label="Paid in 6 months"
          value={<Amount value={paidRecently} />}
          pill={openBills > 0 ? <Pill tone="partial">{openBills} open {openBills === 1 ? "bill" : "bills"}</Pill> : <Pill tone="paid">All bills paid</Pill>}
          note={`${receipts.filter((receipt) => !receipt.voided).length} receipts in total`}
        />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4">
        <section aria-label="Billed and paid chart" className={cn(card, "min-w-0 p-5")}>
          <TenantPaymentsChart points={trend} />
        </section>
        <div className="grid min-w-0 content-start gap-4">
          <PaybillCard paybill={home.paybill} account={lease.unitCode} title="How to pay" />
          <Link
            href="/tenants/report-payment"
            className={cn(card, "flex items-center gap-3 p-4 text-foreground no-underline hover:border-border-strong hover:text-foreground")}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-status-info-surface text-status-info ring-1 ring-status-info-border/60">
              <UploadCloud className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-heading">Paid by bank or cash?</span>
              <span className="block text-xs text-muted-foreground">Report it with a photo of the slip</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <section aria-label="Recent bills" className={cn(card, "min-w-0")}>
          <SectionHeader title="Recent bills" href="/tenants/bills" linkLabel="All bills" />
          {bills.length === 0 ? (
            <p className="px-5 pt-2 pb-8 text-center text-sm text-muted-foreground">No bills yet.</p>
          ) : (
            <ul className="divide-y border-t">
              {bills.slice(0, 5).map((bill) => (
                <li key={bill.invoiceId}>
                  <Link href={`/tenants/bills/${bill.invoiceId}`} className="flex items-center gap-3 px-5 py-3 text-foreground no-underline hover:bg-surface-raised/50 hover:text-foreground">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-heading">{formatPeriod(bill.period)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {bill.number} · due {formatDate(bill.dueDate)}
                      </span>
                    </span>
                    <StatusBadge status={bill.status} />
                    <span className="w-24 text-right text-sm font-semibold text-heading numbers">{formatShillings(bill.total)}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent receipts" className={cn(card, "min-w-0")}>
          <SectionHeader title="Recent receipts" href="/tenants/receipts" linkLabel="All receipts" />
          {receipts.length === 0 ? (
            <p className="px-5 pt-2 pb-8 text-center text-sm text-muted-foreground">Receipts appear here after each payment.</p>
          ) : (
            <ul className="divide-y border-t">
              {receipts.slice(0, 5).map((receipt) => (
                <li key={receipt.paymentId}>
                  <Link
                    href={`/receipts/${receipt.receiptToken}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-5 py-3 text-foreground no-underline hover:bg-surface-raised/50 hover:text-foreground"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised text-text-secondary ring-1 ring-border-strong">
                      <ReceiptText className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-heading">{receipt.receiptNumber}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatNairobiDateTime(receipt.paidAt)} · {receipt.mpesaReceipt ?? receipt.reference ?? receipt.channel}
                      </span>
                    </span>
                    {receipt.voided ? <StatusBadge status="void" /> : null}
                    <span className={cn("text-sm font-semibold numbers", receipt.voided ? "text-muted-foreground line-through" : "text-heading")}>
                      {formatShillings(receipt.amount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("numbers text-[28px] leading-none font-semibold tracking-[-0.02em] text-heading", className)}>
      <span className="mr-1 text-base font-medium opacity-60">KES</span>
      {formatAmount(value)}
    </span>
  );
}

function Pill({ tone, children }: { tone: "paid" | "partial"; children: React.ReactNode }) {
  return <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", statusSurfaceClass(tone))}>{children}</span>;
}

function StatCard({ label, value, pill, note }: { label: string; value: React.ReactNode; pill?: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className={cn(card, "p-5")}>
      <p className="text-sm font-medium text-text-secondary">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {value}
        {pill}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function SectionHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <h2 className="text-lg font-semibold text-heading">{title}</h2>
      <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium">
        {linkLabel} <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}
