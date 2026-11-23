import "server-only";
import { sql } from "drizzle-orm";
import { graceEndsOn } from "@/core/billing";
import { loadPolicyResolver } from "@/services/policies";
import { formatDate, formatPeriod, lastDayOfPeriod, todayInNairobi, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { assertEqual, kes, money, tableTotal, text, type ReportDocument, type Row, type Table, type Tag } from "../document";
import { buildingLabel, finalise, header, LINE_ALLOCATED, query } from "./common";

type UnitRow = { unitId: string; unitCode: string; askingRent: number; buildingId: string; buildingName: string; hasCurrentLease: boolean };
type BillRow = {
  unitId: string;
  leaseId: string;
  leaseStatus: string;
  tenantName: string;
  dueDate: IsoDate;
  rent: number;
  other: number;
  water: number;
  paid: number;
  leaseBalance: number;
};

/** Every unit for a month: what each tenant was billed, what they paid and what is left; vacant units shown, not billed. */
export async function rentRoll(input: { period: BillingPeriod; buildingId?: string | null }): Promise<ReportDocument> {
  const period = input.period;
  const today = todayInNairobi();
  const buildingOnly = input.buildingId ? sql`and b.id = ${input.buildingId}` : sql``;
  const [head, filter, resolver, units, bills] = await Promise.all([
    header("ROL"),
    buildingLabel(input.buildingId),
    loadPolicyResolver(),
    query<UnitRow>(sql`
      select u.id as "unitId", u.code as "unitCode", u.rent_amount as "askingRent", b.id as "buildingId", b.name as "buildingName",
        exists (select 1 from leases l where l.unit_id = u.id and l.status in ('active', 'notice')) as "hasCurrentLease"
      from units u join buildings b on b.id = u.building_id
      where true ${buildingOnly}
      order by b.name, u.code`),
    query<BillRow>(sql`
      select l.unit_id as "unitId", l.id as "leaseId", l.status as "leaseStatus", t.full_name as "tenantName", min(i.due_date)::text as "dueDate",
        coalesce(sum(il.amount - il.waived_amount) filter (where il.type = 'rent'), 0)::int as rent,
        coalesce(sum(il.amount - il.waived_amount) filter (where il.type <> 'rent'), 0)::int as other,
        coalesce(sum(il.amount - il.waived_amount) filter (where il.type = 'water'), 0)::int as water,
        coalesce(sum(${LINE_ALLOCATED}), 0)::int as paid,
        (select coalesce(sum(le.debit - le.credit), 0) from ledger_entries le where le.lease_id = l.id)::int as "leaseBalance"
      from invoices i join invoice_lines il on il.invoice_id = i.id
      join leases l on l.id = i.lease_id join tenants t on t.id = l.tenant_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
      where i.period = ${period} ${buildingOnly}
      group by l.unit_id, l.id, l.status, t.full_name`),
  ]);

  const tableFor = (buildingId: string, title: string): Table => {
    const rows: Row[] = [];
    for (const unit of units.filter((item) => item.buildingId === buildingId)) {
      const unitBills = bills.filter((bill) => bill.unitId === unit.unitId);
      if (unitBills.length === 0) {
        rows.push(
          unit.hasCurrentLease
            ? { unit: text(unit.unitCode), tenant: text("Tenant not billed this month", { italic: true }), rent: money(null), other: money(null), paid: money(null), balance: money(null), status: text("") }
            : {
                unit: text(unit.unitCode, { italic: true }),
                tenant: text(`Vacant · asking ${kes(unit.askingRent)}`, { italic: true }),
                rent: money(null),
                other: money(null),
                paid: money(null),
                balance: money(null),
                status: text("", { tag: { label: "Vacant", tone: "vacant" } }),
              },
        );
        continue;
      }
      for (const bill of unitBills) {
        const balance = bill.rent + bill.other - bill.paid;
        const graceEnd = graceEndsOn(bill.dueDate, resolver(unit.buildingId, today).settings.graceDays);
        const tag: Tag =
          balance <= 0
            ? bill.leaseBalance < 0
              ? { label: "Credit", tone: "credit" }
              : { label: "Paid", tone: "paid" }
            : today > graceEnd
              ? { label: "Overdue", tone: "overdue" }
              : bill.paid > 0
                ? { label: "Partial", tone: "partial" }
                : { label: "Unpaid", tone: "neutral" };
        rows.push({
          unit: text(unit.unitCode),
          tenant: text(bill.tenantName, { sub: bill.leaseStatus === "ended" ? "Moved out" : bill.leaseStatus === "notice" ? "On notice" : undefined }),
          rent: money(bill.rent),
          other: money(bill.other),
          paid: money(bill.paid),
          balance: money(balance),
          status: text("", { tag }),
        });
      }
    }
    const billed = rows.reduce((sum, row) => sum + (row.rent?.kind === "money" ? (row.rent.amount ?? 0) : 0) + (row.other?.kind === "money" ? (row.other.amount ?? 0) : 0), 0);
    const paid = rows.reduce((sum, row) => sum + (row.paid?.kind === "money" ? (row.paid.amount ?? 0) : 0), 0);
    return {
      id: `building-${buildingId}`,
      title,
      hideTitle: true,
      columns: [
        { key: "unit", label: "Unit", type: "text", width: "10%" },
        { key: "tenant", label: "Tenant", type: "text" },
        { key: "rent", label: "Rent", type: "money", sum: true, width: "13%" },
        { key: "other", label: "Other charges", type: "money", sum: true, width: "13%" },
        { key: "paid", label: "Paid", type: "money", sum: true, width: "13%" },
        { key: "balance", label: "Balance", type: "money", sum: true, width: "13%" },
        { key: "status", label: "Status", type: "text", width: "13%" },
      ],
      rows,
      total: { label: `Total ${title}`, cells: { status: text(billed > 0 ? `${Math.round((paid / billed) * 100)}% collected` : "—") } },
    };
  };

  const buildings = [...new Map(units.map((unit) => [unit.buildingId, unit.buildingName])).entries()];
  const tables = buildings.map(([id, name]) => tableFor(id, name));
  const sum = (key: string) => tables.reduce((total, table) => total + tableTotal(table, key), 0);
  const rentBilled = sum("rent");
  const otherBilled = sum("other");
  const collected = sum("paid");
  const outstanding = sum("balance");
  assertEqual("rent-roll", "rent + other − paid vs balance", rentBilled + otherBilled - collected, outstanding);
  assertEqual("rent-roll", "rows vs bills", rentBilled + otherBilled, bills.reduce((total, bill) => total + bill.rent + bill.other, 0));
  const water = bills.reduce((total, bill) => total + bill.water, 0);

  const vacant = units.filter((unit) => !unit.hasCurrentLease && !bills.some((bill) => bill.unitId === unit.unitId));
  const vacantRent = vacant.reduce((total, unit) => total + unit.askingRent, 0);
  const occupied = units.filter((unit) => unit.hasCurrentLease).length;
  const label = formatPeriod(period);
  const billed = rentBilled + otherBilled;

  const document: ReportDocument = {
    ...head,
    slug: "rent-roll",
    kind: "Rent roll",
    title: "Rent roll and collections",
    period: label,
    filter,
    summary: [
      { label: "Collected", value: kes(collected), number: collected, money: true, note: billed ? `${Math.round((collected / billed) * 100)}% of ${kes(billed)} billed` : "Nothing billed" },
      { label: "Billed", value: kes(billed), number: billed, money: true, note: `Rent ${kes(rentBilled)}` },
      { label: "Outstanding", value: kes(outstanding), number: outstanding, money: true, note: `On ${label} bills` },
      { label: "Occupied units", value: `${occupied} of ${units.length}`, number: occupied, note: `${vacant.length} vacant` },
    ],
    sections: tables.map((table) => ({ id: table.id, title: table.title, blocks: [{ kind: "table" as const, table }] })),
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: [
            { label: "Rent billed", op: "+", amount: rentBilled },
            { label: "Water and other charges", op: "+", amount: otherBilled, sub: water ? `Water ${kes(water)}` : undefined },
            { label: "Collected", op: "−", amount: collected },
          ],
          result: { label: lastDayOfPeriod(period) < today ? `Outstanding at month end, ${formatDate(lastDayOfPeriod(period))}` : `Outstanding at ${formatDate(today)}`, amount: outstanding },
          notes: [
            vacant.length
              ? `Rent not earned on vacant units: ${kes(vacantRent)} (${vacant.map((unit) => unit.unitCode).join(", ")}), not billed and not in the figures above.`
              : "No vacant units this month.",
          ],
        },
      ],
    },
    fileName: `rentpay-rent-roll-${period}`,
  };
  return finalise(document);
}
