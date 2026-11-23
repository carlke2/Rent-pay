import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, ReceiptText, Smartphone, UploadCloud } from "lucide-react";
import {
  Amount,
  DashboardHeader,
  dashboardCard as card,
  dashboardTable,
  HighlightBadge,
  HighlightTile,
  NoAmount,
  Pill,
  SectionHeader,
  StatTile,
} from "@/components/shared/dashboard";
import { StatusBadge } from "@/components/shared/status-badge";
import { TrendChart } from "@/components/shared/trend-chart-lazy";
import { Button } from "@/components/shared/ui/button";
import { PaybillCard } from "@/components/tenants/paybill-card";
import { getTenantOverview } from "@/services/portal";
import { cn } from "@/utilities/class-names";
import { currentPeriod, formatDate, formatNairobiDateTime, formatPeriod } from "@/utilities/dates";
import { formatShillings, sumShillings } from "@/utilities/money";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Overview" };

const STATUS_LABEL = { paid: "Paid up", overdue: "Overdue", partial: "Part paid" } as const;

/** The tenant's dashboard, built from the same pieces and grid as the landlord overview. */
export default async function TenantOverviewPage() {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const { home, trend, openBills, recentBills, recentReceipts, receiptCount } = await getTenantOverview(lease, 12);
  const owes = home.balance > 0;
  const paidInSixMonths = sumShillings(trend.slice(-6).map((point) => point.paid));
  const statusLabel = STATUS_LABEL[home.status as keyof typeof STATUS_LABEL] ?? (owes ? "Due" : "Up to date");
  const canPay = lease.isCurrent;

  return (
    <>
      <DashboardHeader
        display
        title={`Hi ${home.firstName}`}
        description={`${lease.unitCode} · ${lease.buildingName}${lease.isCurrent ? "" : " · moved out"}`}
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="px-4 text-foreground">
              <Link prefetch={false} href="/tenants/statement" className="no-underline">
                Statement <ArrowUpRight aria-hidden />
              </Link>
            </Button>
            {canPay ? (
              // On phones the Pay button lives full width in the Amount due card instead.
              <Button asChild size="sm" className="hidden px-4 sm:inline-flex">
                <Link prefetch={false} href="/tenants/pay" className="no-underline">
                  <Smartphone aria-hidden /> Pay rent
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <section aria-label="Your account" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HighlightTile
          label={owes ? "Amount due" : home.balance < 0 ? "Credit" : "Balance"}
          badge={<HighlightBadge>{statusLabel}</HighlightBadge>}
          value={<Amount value={Math.abs(home.balance)} className="text-primary-foreground" />}
          note={owes ? `Due ${formatDate(home.dueDate)}` : home.balance < 0 ? "Goes towards your next bill" : `Next rent due ${formatDate(home.dueDate)}`}
        >
          {canPay && owes ? (
            <Link prefetch={false}
              href="/tenants/pay"
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary-foreground px-4 text-sm font-semibold text-primary no-underline hover:bg-primary-foreground/85 hover:text-primary"
            >
              Pay {formatShillings(home.balance)}
            </Link>
          ) : null}
        </HighlightTile>

        <StatTile label="Monthly rent" value={<Amount value={lease.rentAmount} />} note={`Next due ${formatDate(home.dueDate)}`} />

        <StatTile
          label="Last payment"
          value={home.lastPayment ? <Amount value={home.lastPayment.amount} /> : <NoAmount />}
          note={
            home.lastPayment ? (
              <>
                {formatNairobiDateTime(home.lastPayment.paidAt)}
                {home.lastPayment.receiptToken ? (
                  <>
                    {" · "}
                    <Link prefetch={false} href={`/receipts/${home.lastPayment.receiptToken}`} target="_blank" rel="noreferrer">
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

        <StatTile
          label="Paid in 6 months"
          value={<Amount value={paidInSixMonths} />}
          pill={openBills > 0 ? <Pill tone="partial">{openBills} open {openBills === 1 ? "bill" : "bills"}</Pill> : <Pill tone="paid">All bills paid</Pill>}
          note={`${receiptCount} ${receiptCount === 1 ? "receipt" : "receipts"} in total`}
        />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Billed and paid chart" className={cn(card, "min-w-0 p-5")}>
          <TrendChart
            title="Billed and paid"
            labels={{ actual: "Paid", target: "Billed" }}
            points={trend.map((point) => ({ period: point.period, actual: point.paid, target: point.billed }))}
            selectedPeriod={currentPeriod()}
            emptyText="Your first bill will show here."
          />
        </section>
        <div className="grid min-w-0 content-start gap-4">
          <PaybillCard paybill={home.paybill} account={lease.unitCode} title="How to pay" className={cn(card, "p-5")} />
          <Link prefetch={false} href="/tenants/report-payment" className={cn(card, "flex items-center gap-3 p-4 text-foreground no-underline hover:border-border-strong hover:text-foreground")}>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentBills bills={recentBills} />
        <RecentReceipts receipts={recentReceipts} />
      </div>
    </>
  );
}

type Overview = Awaited<ReturnType<typeof getTenantOverview>>;
type Bill = Overview["recentBills"][number];
type Receipt = Overview["recentReceipts"][number];

function AllLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild size="sm" variant="outline" className="px-3 text-foreground">
      <Link prefetch={false} href={href} className="no-underline">
        {children} <ArrowUpRight aria-hidden />
      </Link>
    </Button>
  );
}

/** Like the landlord's "Latest payments": a table from md up, stacked rows on phones; every row opens the bill. */
function RecentBills({ bills }: { bills: Bill[] }) {
  return (
    <section aria-label="Recent bills" className={cn(card, "min-w-0")}>
      <div className="p-5 pb-3">
        <SectionHeader title="Recent bills" action={<AllLink href="/tenants/bills">All bills</AllLink>} />
      </div>
      {bills.length === 0 ? (
        <p className="px-5 pt-4 pb-8 text-center text-sm text-muted-foreground">No bills yet.</p>
      ) : (
        <>
          <ul className="divide-y border-t md:hidden">
            {bills.map((bill) => (
              <li key={bill.invoiceId}>
                <Link prefetch={false} href={`/tenants/bills/${bill.invoiceId}`} className="flex items-center gap-3 px-5 py-3 text-foreground no-underline hover:bg-surface-raised/50 hover:text-foreground">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-heading">{formatPeriod(bill.period)}</span>
                    <span className="numbers block text-xs text-muted-foreground">
                      {bill.number} · due {formatDate(bill.dueDate)}
                    </span>
                  </span>
                  <StatusBadge status={bill.status} />
                  <span className="numbers text-right text-sm font-semibold text-heading">{formatShillings(bill.total)}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className={cn(dashboardTable.table, "min-w-[560px]")}>
              <thead>
                <tr className={dashboardTable.headRow}>
                  <th scope="col" className={dashboardTable.th}>Month</th>
                  <th scope="col" className={dashboardTable.th}>Invoice</th>
                  <th scope="col" className={dashboardTable.th}>Due date</th>
                  <th scope="col" className={dashboardTable.th}>Status</th>
                  <th scope="col" className={cn(dashboardTable.th, "text-right")}>Amount</th>
                  <th scope="col" className={dashboardTable.th}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className={dashboardTable.body}>
                {bills.map((bill) => (
                  // The row is clickable via the stretched month link; the chevron is decorative.
                  <tr key={bill.invoiceId} className={cn(dashboardTable.row, "relative")}>
                    <td className={cn(dashboardTable.td, "font-medium whitespace-nowrap text-heading")}>
                      <Link prefetch={false} href={`/tenants/bills/${bill.invoiceId}`} className="text-heading no-underline after:absolute after:inset-0 hover:text-heading">
                        {formatPeriod(bill.period)}
                      </Link>
                    </td>
                    <td className={cn(dashboardTable.td, "numbers whitespace-nowrap text-text-secondary")}>{bill.number}</td>
                    <td className={cn(dashboardTable.td, "numbers whitespace-nowrap text-text-secondary")}>{formatDate(bill.dueDate)}</td>
                    <td className={dashboardTable.td}>
                      <StatusBadge status={bill.status} />
                    </td>
                    <td className={cn(dashboardTable.td, "numbers text-right font-semibold whitespace-nowrap text-heading")}>{formatShillings(bill.total)}</td>
                    <td className={cn(dashboardTable.td, "w-10 text-right")}>
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function RecentReceipts({ receipts }: { receipts: Receipt[] }) {
  return (
    <section aria-label="Recent receipts" className={cn(card, "flex min-w-0 flex-col")}>
      <div className="p-5 pb-3">
        <SectionHeader title="Recent receipts" action={<AllLink href="/tenants/receipts">All</AllLink>} />
      </div>
      {receipts.length === 0 ? (
        <p className="px-5 pt-4 pb-8 text-center text-sm text-muted-foreground">Receipts appear here after each payment.</p>
      ) : (
        <ul className="divide-y border-t">
          {receipts.map((receipt) => (
            <li key={receipt.paymentId}>
              <Link prefetch={false}
                href={`/receipts/${receipt.receiptToken}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-5 py-3 text-foreground no-underline hover:bg-surface-raised/50 hover:text-foreground"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised text-text-secondary ring-1 ring-border-strong">
                  <ReceiptText className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="numbers block truncate text-sm font-medium text-heading">{receipt.receiptNumber}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatNairobiDateTime(receipt.paidAt)}</span>
                </span>
                {receipt.voided ? <StatusBadge status="void" /> : null}
                <span className={cn("numbers text-sm font-semibold", receipt.voided ? "text-muted-foreground line-through" : "text-heading")}>{formatShillings(receipt.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
