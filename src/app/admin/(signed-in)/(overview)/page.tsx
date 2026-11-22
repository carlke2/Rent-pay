import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ATTENTION_ICONS } from "@/components/admin/attention-icons";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { CollectionsChart } from "@/components/admin/collections-chart";
import { SendReminderButton } from "@/components/admin/send-reminder-button";
import { StatusBadge, statusSurfaceClass } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import { dashboard, type AttentionItem, type BoardUnit } from "@/services/reports";
import { cn } from "@/utilities/class-names";
import { currentPeriod, isBillingPeriod } from "@/utilities/dates";
import { formatAmount, formatShillings } from "@/utilities/money";

export const metadata: Metadata = { title: "Overview" };

const card = "rounded-[14px] border bg-card";

export default async function OverviewPage({ searchParams }: PageProps<"/admin">) {
  const query = await searchParams;
  const requested = typeof query.period === "string" && isBillingPeriod(query.period) ? query.period : null;
  const period = requested && requested <= currentPeriod() ? requested : undefined;
  const data = await dashboard({ period });

  return (
    <>
      <AutoRefresh seconds={30} />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-heading sm:text-[28px]">Rent collection</h1>
          <p className="mt-1 text-sm text-text-secondary">Updates the moment a payment arrives</p>
        </div>
        <Button asChild size="sm" className="px-4">
          <Link href={`/admin/reports?report=collection-summary&period=${data.period}`} className="no-underline">
            Collection report <ArrowUpRight aria-hidden />
          </Link>
        </Button>
      </div>

      <section aria-label="This month in numbers" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[14px] bg-primary p-5 text-primary-foreground">
          <p className="text-sm font-medium text-primary-foreground/60">Collected</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Amount value={data.collected.amount} className="text-primary-foreground" />
            {data.collected.percentOfExpected !== null ? (
              <span className="rounded-full bg-primary-foreground px-2.5 py-0.5 text-xs font-semibold text-primary numbers">{data.collected.percentOfExpected}%</span>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-primary-foreground/60">
            of {formatShillings(data.collected.expected)} expected · {data.collected.paidUnits} of {data.collected.occupied} units paid
          </p>
        </div>

        <StatCard label="Expected" value={<Amount value={data.expected.amount} />} note={`Rent, water and charges · ${data.expected.occupied} occupied ${data.expected.occupied === 1 ? "unit" : "units"}`} />

        <StatCard
          label="Arrears"
          value={<Amount value={data.arrears.amount} />}
          pill={data.arrears.overdue > 0 ? <Pill tone="overdue">{data.arrears.overdue} overdue</Pill> : null}
          note={
            data.arrears.owingUnits > 0
              ? `${data.arrears.owingUnits} ${data.arrears.owingUnits === 1 ? "unit owes" : "units owe"}${data.arrears.oldestDays > 0 ? ` · oldest ${data.arrears.oldestDays} days` : ""}`
              : "Nobody owes anything"
          }
        />

        <StatCard
          label="Occupancy"
          value={
            <span className="numbers text-[28px] leading-none font-semibold tracking-[-0.02em] text-heading">
              {data.occupancy.occupied} <span className="text-text-secondary">/ {data.occupancy.total}</span>
            </span>
          }
          pill={<Pill tone="paid">{data.occupancy.percent}%</Pill>}
          note={`${data.occupancy.vacant} vacant · ${data.occupancy.notice} on notice`}
        />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section aria-label="Collections chart" className={cn(card, "min-w-0 p-5")}>
          <CollectionsChart points={data.trend} selectedPeriod={data.period} />
        </section>
        <NeedsAttention items={data.attention.items} total={data.attention.total} />
      </div>

      <LatestPayments payments={data.latestPayments} />

      <Buildings buildings={data.buildings} />
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

function Pill({ tone, children }: { tone: "paid" | "overdue"; children: React.ReactNode }) {
  return <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold numbers", statusSurfaceClass(tone))}>{children}</span>;
}

function StatCard({ label, value, pill, note }: { label: string; value: React.ReactNode; pill?: React.ReactNode; note: string }) {
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

function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-heading">
        {title}
        {count ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground numbers">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

function NeedsAttention({ items, total }: { items: AttentionItem[]; total: number }) {
  return (
    <section aria-label="Needs attention" className={cn(card, "flex min-w-0 flex-col p-5")}>
      <SectionHeader title="Needs attention" count={total} />
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <CheckCircle2 className="size-8 text-status-paid" aria-hidden />
          <p className="text-sm text-text-secondary">All clear. Nothing needs you right now.</p>
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-1 divide-y">
          {items.map((item) => {
            const { icon: Icon, tile } = ATTENTION_ICONS[item.kind];
            return (
              <li key={`${item.kind}-${item.id}`} className="flex min-w-0 items-center gap-3 py-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-[10px] ring-1", tile)}>
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-heading">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.meta}</p>
                </div>
                <AttentionAction item={item} />
              </li>
            );
          })}
        </ul>
      )}
      {total > items.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {total - items.length} more · <Link href="/admin/payments?tab=unmatched">Payments</Link> · <Link href="/admin/meter-readings">Meter readings</Link>
        </p>
      ) : null}
    </section>
  );
}

function AttentionAction({ item }: { item: AttentionItem }) {
  const small = "shrink-0 px-3";
  if (item.kind === "unmatched") {
    return (
      <Button asChild size="sm" className={small}>
        <Link href={item.href} className="no-underline" aria-label={`Assign ${item.title}`}>
          Assign
        </Link>
      </Button>
    );
  }
  if (item.kind === "claim" || item.kind === "reading") {
    const label = item.kind === "claim" ? "Review" : "Check";
    return (
      <Button asChild size="sm" variant="outline" className={cn(small, "text-foreground")}>
        <Link href={item.href} className="no-underline" aria-label={`${label}: ${item.title}`}>
          {label}
        </Link>
      </Button>
    );
  }
  return <SendReminderButton leaseId={item.leaseId} sentToday={item.remindedToday} label={`Send reminder to ${item.unitCode}`} className={cn(small, "text-foreground")} />;
}

type LatestPayment = Awaited<ReturnType<typeof dashboard>>["latestPayments"][number];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function LatestPayments({ payments }: { payments: LatestPayment[] }) {
  return (
    <section aria-label="Latest payments" className={cn(card, "mb-6 min-w-0")}>
      <div className="p-5 pb-3">
        <SectionHeader
          title="Latest payments"
          action={
            <Button asChild size="sm" variant="outline" className="px-3 text-foreground">
              <Link href="/admin/payments" className="no-underline">
                All payments <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          }
        />
      </div>
      {payments.length === 0 ? (
        <p className="px-5 pb-8 pt-4 text-center text-sm text-muted-foreground">No payments yet. They appear here the moment they arrive.</p>
      ) : (
        <>
        <ul className="divide-y border-t md:hidden">
          {payments.map((payment) => (
            <li key={payment.id} className="grid gap-2 px-5 py-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-heading">{payment.name}</span>
                <span className="numbers shrink-0 font-semibold text-heading">{formatShillings(payment.amount)}</span>
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-text-secondary">
                <dt>Receipt</dt>
                <dd className="numbers truncate text-right">{payment.mpesaReceipt ?? payment.receiptNumber ?? "–"}</dd>
                <dt>Unit</dt>
                <dd className="truncate text-right">{payment.unitCode ?? "–"}</dd>
                <dt>Channel</dt>
                <dd className="truncate text-right">{payment.channel}</dd>
                <dt>Paid</dt>
                <dd className="numbers truncate text-right">{payment.paidAt}</dd>
                <dt>Status</dt>
                <dd className="text-right">
                  <StatusBadge status={payment.matchStatus} />
                </dd>
              </dl>
              {payment.matchStatus === "unmatched" ? (
                <Button asChild size="sm" className="mt-1 w-full">
                  <Link href={`/admin/payments?tab=unmatched&payment=${payment.id}`} className="no-underline">
                    Assign
                  </Link>
                </Button>
              ) : payment.receiptToken ? (
                <Button asChild size="sm" variant="outline" className="mt-1 w-full text-foreground">
                  <Link href={`/receipts/${payment.receiptToken}`} target="_blank" rel="noreferrer" className="no-underline">
                    Receipt
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="relative hidden overflow-x-auto md:block">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-y bg-surface-sunken text-left text-xs font-medium text-muted-foreground">
                <th scope="col" className="px-5 py-2.5 font-medium">Receipt</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Tenant</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Unit</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Channel</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Paid</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((payment) => (
                <tr key={payment.id} className="hover:bg-surface-raised/50">
                  <td className="px-5 py-3 font-medium text-heading numbers">{payment.mpesaReceipt ?? payment.receiptNumber ?? "–"}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-raised text-xs font-semibold text-heading ring-1 ring-border-strong">
                        {initialsOf(payment.name) || "?"}
                      </span>
                      <span className="whitespace-nowrap">{payment.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-text-secondary">{payment.unitCode ?? "–"}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-text-secondary">{payment.channel}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={payment.matchStatus} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-text-secondary numbers">{payment.paidAt}</td>
                  <td className="px-3 py-3 text-right font-semibold whitespace-nowrap text-heading numbers">{formatShillings(payment.amount)}</td>
                  <td className="px-5 py-3 text-right">
                    {payment.matchStatus === "unmatched" ? (
                      <Button asChild size="sm" className="px-3">
                        <Link href={`/admin/payments?tab=unmatched&payment=${payment.id}`} className="no-underline">
                          Assign
                        </Link>
                      </Button>
                    ) : payment.receiptToken ? (
                      <Button asChild size="sm" variant="outline" className="px-3 text-foreground">
                        <Link href={`/receipts/${payment.receiptToken}`} target="_blank" rel="noreferrer" className="no-underline">
                          Receipt
                        </Link>
                      </Button>
                    ) : null}
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

const LEGEND = [
  ["paid", "Paid"],
  ["partial", "Partial"],
  ["unpaid", "Unpaid"],
  ["overdue", "Overdue"],
  ["notice", "On notice"],
  ["vacant", "Vacant"],
] as const;

/** The tile colour: overdue wins, then "on notice", then the payment status. */
function tileStatus(unit: BoardUnit): string {
  if (unit.paymentStatus === "overdue") return "overdue";
  if (unit.leaseStatus === "notice") return "notice";
  return unit.paymentStatus;
}

const STATUS_WORDS: Record<string, string> = { paid: "paid", partial: "partly paid", unpaid: "unpaid", overdue: "overdue", notice: "on notice", vacant: "vacant" };

function Buildings({ buildings }: { buildings: Awaited<ReturnType<typeof dashboard>>["buildings"] }) {
  return (
    <section aria-label="Buildings">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-heading">Buildings</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-secondary" aria-label="Legend">
          {LEGEND.map(([status, label]) => (
            <li key={status} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-3 rounded-[4px] border", statusSurfaceClass(status))} />
              {label}
            </li>
          ))}
        </ul>
      </div>
      {buildings.length === 0 ? (
        <p className={cn(card, "p-8 text-center text-sm text-muted-foreground")}>
          No buildings yet. <Link href="/admin/buildings">Add your first building</Link>.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {buildings.map((building) => (
            <article key={building.buildingId} className={cn(card, "p-5")}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">
                    <Link href={`/admin/buildings/${building.buildingId}`} className="text-heading no-underline hover:text-heading hover:underline">
                      {building.buildingName}
                    </Link>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {building.totals.units} units · {building.totals.occupied} occupied · {building.totals.notice} on notice
                  </p>
                </div>
                <p className="text-right text-xs text-text-secondary">
                  Collected <span className="font-semibold text-heading numbers">{formatShillings(building.totals.collected)}</span>
                  <br />
                  of <span className="numbers">{formatShillings(building.totals.expected)}</span>
                </p>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {building.units.map((unit) => {
                  const status = tileStatus(unit);
                  return (
                    <li key={unit.unitId}>
                      <Link
                        href={`/admin/units/${unit.unitId}`}
                        aria-label={`${unit.unitCode}: ${STATUS_WORDS[status] ?? status}, balance ${formatShillings(Math.max(0, unit.balance))}`}
                        title={`${unit.unitCode}${unit.tenantName ? ` · ${unit.tenantName}` : ""}`}
                        className={cn("flex h-11 min-w-[52px] items-center justify-center rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap no-underline hover:brightness-125", statusSurfaceClass(status))}
                      >
                        {unit.unitCode}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
