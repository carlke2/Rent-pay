import "server-only";
import { sql } from "drizzle-orm";
import { addDays, formatDate, startOfNairobiDay, type IsoDate } from "@/utilities/dates";
import { assertEqual, kes, money, numberOf, tableTotal, text, type CalcLine, type Column, type ReportDocument, type Row, type Table } from "../document";
import { at, buildingLabel, finalise, header, query } from "./common";

const INCOME_ROWS = [
  { key: "rent", label: "Rent", types: ["rent"] },
  { key: "water", label: "Water", types: ["water"] },
  { key: "service", label: "Service and other charges", types: ["fixed", "other"] },
  { key: "late", label: "Late fees", types: ["penalty"] },
] as const;

/** Money received (by what it paid for) and money spent, per building, for a date range. Deposits are not income. */
export async function incomeAndExpenses(input: { from: IsoDate; to: IsoDate; buildingId?: string | null }): Promise<ReportDocument> {
  const { from, to } = input;
  if (from > to) throw new RangeError("From must be on or before To");
  const start = startOfNairobiDay(from);
  const end = startOfNairobiDay(addDays(to, 1));
  const buildingOnly = (column: string) => (input.buildingId ? sql`and ${sql.raw(column)} = ${input.buildingId}` : sql``);
  const received = sql`p.match_status = 'matched' and p.source = 'live' and p.channel <> 'opening' and p.paid_at >= ${at(start)} and p.paid_at < ${at(end)}`;

  const [head, filter, buildings, allocated, paid, spent, unmatched] = await Promise.all([
    header("INC"),
    buildingLabel(input.buildingId),
    query<{ id: string; name: string }>(sql`select b.id, b.name from buildings b where true ${buildingOnly("b.id")} order by b.name`),
    query<{ buildingId: string; type: string; amount: number }>(sql`
      select u.building_id as "buildingId", il.type, sum(a.amount)::int as amount
      from payments p join allocations a on a.payment_id = p.id join invoice_lines il on il.id = a.invoice_line_id
      join leases l on l.id = p.lease_id join units u on u.id = l.unit_id
      where ${received} ${buildingOnly("u.building_id")}
      group by 1, 2`),
    query<{ buildingId: string; amount: number }>(sql`
      select u.building_id as "buildingId", sum(p.amount)::int as amount
      from payments p join leases l on l.id = p.lease_id join units u on u.id = l.unit_id
      where ${received} ${buildingOnly("u.building_id")}
      group by 1`),
    query<{ buildingId: string; category: string; amount: number; notes: string | null; items: number }>(sql`
      select e.building_id as "buildingId", e.category, sum(e.amount)::int as amount, count(*)::int as items,
        string_agg(distinct nullif(trim(e.note), ''), '; ') as notes
      from expenses e where e.spent_on between ${from} and ${to} ${buildingOnly("e.building_id")}
      group by 1, 2`),
    query<{ amount: number; count: number }>(sql`
      select coalesce(sum(p.amount), 0)::int as amount, count(*)::int as count from payments p
      where p.match_status = 'unmatched' and p.source = 'live' and p.paid_at >= ${at(start)} and p.paid_at < ${at(end)}`),
  ]);

  const columns = (first: Column): Column[] => [
    first,
    ...buildings.map((building) => ({ key: `b_${building.id}`, label: building.name, type: "money" as const, sum: true })),
    ...(buildings.length > 1 ? [{ key: "total", label: "Total", type: "money" as const, sum: true }] : []),
  ];
  const lineOf = (label: Row[string], amountFor: (buildingId: string) => number, extra: Row = {}): Row => {
    const row: Row = { label, ...extra };
    let total = 0;
    for (const building of buildings) {
      const amount = amountFor(building.id);
      total += amount;
      row[`b_${building.id}`] = money(amount || null);
    }
    if (buildings.length > 1) row.total = money(total || null);
    return row;
  };

  // ---- Income ----
  const allocatedTo = (buildingId: string, types: readonly string[]) =>
    allocated.filter((row) => row.buildingId === buildingId && types.includes(row.type)).reduce((sum, row) => sum + row.amount, 0);
  const deposits = (buildingId: string) => allocatedTo(buildingId, ["deposit"]);
  const paidIn = (buildingId: string) => paid.find((row) => row.buildingId === buildingId)?.amount ?? 0;
  const allAllocated = (buildingId: string) => allocated.filter((row) => row.buildingId === buildingId).reduce((sum, row) => sum + row.amount, 0);
  const advance = (buildingId: string) => paidIn(buildingId) - allAllocated(buildingId);

  const incomeRows: Row[] = [
    ...INCOME_ROWS.map((item) => lineOf(text(item.label), (buildingId) => allocatedTo(buildingId, item.types))),
    lineOf(text("Paid in advance", { sub: "Not yet used on a bill" }), advance),
    // Only deposits are ever refunded, and deposits are not income, so nothing here is reduced by a refund.
    lineOf(text("Less refunds", { sub: "Deposit refunds are not income" }), () => 0),
  ];
  const incomeTable: Table = { id: "income", title: "Income", columns: columns({ key: "label", label: "Income", type: "text" }), rows: incomeRows, total: { label: "Total income" } };

  // ---- Expenses ----
  const categories = [...new Set(spent.map((row) => row.category))].sort();
  const expenseRows: Row[] = categories.map((category) => {
    const rows = spent.filter((row) => row.category === category);
    const notes = rows.map((row) => row.notes).filter(Boolean).join("; ");
    const items = rows.reduce((sum, row) => sum + row.items, 0);
    return lineOf(text(category, { sub: notes ? truncate(notes, 70) : `${items} ${items === 1 ? "item" : "items"}` }), (buildingId) => rows.find((row) => row.buildingId === buildingId)?.amount ?? 0);
  });
  const expensesTable: Table = {
    id: "expenses",
    title: "Expenses",
    columns: columns({ key: "label", label: "Expenses", type: "text" }),
    rows: expenseRows,
    total: { label: "Total expenses" },
    emptyText: "No expenses recorded for these dates.",
  };

  // Row totals equal the sum of the building columns; income plus deposits equals the money received.
  for (const table of [incomeTable, expensesTable]) {
    for (const row of table.rows) {
      if (buildings.length > 1) assertEqual("income-expenses", `${table.title} row total`, numberOf(row.total), buildings.reduce((sum, building) => sum + numberOf(row[`b_${building.id}`]), 0));
    }
  }
  const key = buildings.length > 1 ? "total" : `b_${buildings[0]?.id}`;
  const income = buildings.length ? tableTotal(incomeTable, key) : 0;
  const expenses = buildings.length ? tableTotal(expensesTable, key) : 0;
  const depositTotal = buildings.reduce((sum, building) => sum + deposits(building.id), 0);
  assertEqual("income-expenses", "income + deposits vs payments received", income + depositTotal, paid.reduce((sum, row) => sum + row.amount, 0));

  const netLines: CalcLine[] =
    buildings.length > 1
      ? buildings.map((building) => {
          const net = tableTotal(incomeTable, `b_${building.id}`) - tableTotal(expensesTable, `b_${building.id}`);
          return { label: `Net, ${building.name}`, op: "" as const, amount: null, display: kes(net) };
        })
      : [];
  const range = `${formatDate(from)} – ${formatDate(to)}`;
  const net = income - expenses;

  const document: ReportDocument = {
    ...head,
    slug: "income-expenses",
    kind: "Financial report",
    title: "Income and expenses",
    period: range,
    filter,
    summary: [
      { label: "Net income", value: kes(net), number: net, money: true, note: "Income less expenses" },
      { label: "Income", value: kes(income), number: income, money: true, note: "Payments received, by what they paid" },
      { label: "Expenses", value: kes(expenses), number: expenses, money: true, note: `${expenseRows.length} ${expenseRows.length === 1 ? "category" : "categories"}` },
      { label: "Deposits received", value: kes(depositTotal), number: depositTotal, money: true, note: "Held for tenants, not income" },
    ],
    sections: [
      { id: "income", title: "Income", blocks: [{ kind: "table", table: { ...incomeTable, hideTitle: true } }] },
      { id: "expenses", title: "Expenses", blocks: [{ kind: "table", table: { ...expensesTable, hideTitle: true } }] },
    ],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: [{ label: "Total income", op: "+", amount: income }, { label: "Total expenses", op: "−", amount: expenses }, ...netLines],
          result: { label: `Net income, ${range}`, amount: net },
          notes: [
            `Deposits are not income: ${kes(depositTotal)} received as deposits is held for tenants and left out.`,
            ...(unmatched[0]?.count ? [`${kes(unmatched[0].amount)} in ${unmatched[0].count} unmatched ${unmatched[0].count === 1 ? "payment" : "payments"} is left out until it is assigned to a tenant.`] : []),
          ],
        },
      ],
    },
    fileName: `rentpay-income-expenses-${from}-to-${to}`,
  };
  return finalise(document);
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}
