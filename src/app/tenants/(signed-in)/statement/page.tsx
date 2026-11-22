import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PrintPageButton } from "@/components/shared/print-page-button";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import { TenantCard, TenantHeading } from "@/components/tenants/tenant-heading";
import { getLeaseStatement } from "@/services/billing";
import { addMonthsToDate, formatDate, isIsoDate, laterDate, todayInNairobi } from "@/utilities/dates";
import { currentTenantLease } from "../../current-lease";

export const metadata: Metadata = { title: "Statement" };

export default async function StatementPage({ searchParams }: PageProps<"/tenants/statement">) {
  const { lease } = await currentTenantLease();
  if (!lease) return null;
  const query = await searchParams;
  const today = todayInNairobi();
  const defaultFrom = laterDate(addMonthsToDate(today, -6), lease.startDate);
  const from = typeof query.from === "string" && isIsoDate(query.from) ? query.from : defaultFrom;
  const to = typeof query.to === "string" && isIsoDate(query.to) ? query.to : undefined;
  const statement = await getLeaseStatement({ leaseId: lease.leaseId, from, to: to && to >= from ? to : undefined });

  return (
    <div className="grid gap-4">
      <TenantHeading title="Statement" description={`${lease.tenantName} · ${lease.unitCode}`} back="/tenants/more" />
      <form method="get" className="grid grid-cols-2 gap-2 print:hidden">
        <div className="grid gap-1">
          <Label htmlFor="from" className="text-text-secondary">From</Label>
          <Input id="from" name="from" type="date" defaultValue={statement.from} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="to" className="text-text-secondary">To</Label>
          <Input id="to" name="to" type="date" defaultValue={statement.to} />
        </div>
        <Button type="submit" variant="outline" className="col-span-2">Show</Button>
      </form>
      <p className="hidden text-sm print:block">
        {formatDate(statement.from)} – {formatDate(statement.to)}
      </p>

      <TenantCard>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Opening balance</span>
          <Money amount={statement.openingBalance} balance className="font-medium" />
        </div>
        {statement.entries.length === 0 ? (
          <div className="py-4"><EmptyState icon={ScrollText} title="Nothing in this period" /></div>
        ) : (
          <ul className="my-3 divide-y divide-border border-y border-border">
            {statement.entries.map((entry) => (
              <li key={entry.id} className="grid grid-cols-[1fr_auto] gap-x-3 py-2.5 text-sm">
                <span className="font-medium text-heading">{entry.description ?? entry.reference}</span>
                <span className={entry.credit ? "text-status-paid" : ""}>
                  {entry.credit ? "−" : "+"}
                  <Money amount={entry.credit || entry.debit} />
                </span>
                <span className="text-muted-foreground">
                  {formatDate(entry.date)}
                  {entry.description && entry.type !== "charge" ? ` · ${entry.reference}` : ""}
                </span>
                <span className="text-right text-muted-foreground">
                  <Money amount={entry.balance} balance />
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between">
          <span className="font-semibold text-heading">Closing balance</span>
          <Money amount={statement.closingBalance} balance className="text-lg font-semibold text-heading" />
        </div>
      </TenantCard>
      <div className="print:hidden">
        <PrintPageButton label="Print / Save as PDF" large />
      </div>
    </div>
  );
}
