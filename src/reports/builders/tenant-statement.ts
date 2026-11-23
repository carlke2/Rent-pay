import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/database/client";
import { loadRentResolver } from "@/services/billing";
import { loadPolicyResolver } from "@/services/policies";
import { depositHeld } from "@/services/tenancy";
import { addMonthsToPeriod, dateInPeriod, daysBetween, formatDate, periodOf, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { assertEqual, kes, money, text, type ReportDocument, type Row, type Table } from "../document";
import { CHANNEL_LABELS, finalise, header, LINE_OPEN, query } from "./common";

export class StatementLeaseMissing extends Error {}

function lateFee(penalty: { type: string; amount: number; percent: number; repeat: string }): string {
  if (penalty.type === "none") return "None";
  const amount = penalty.type === "flat" ? kes(penalty.amount) : `${penalty.percent}% of the unpaid bill`;
  return `${amount}${penalty.repeat === "monthly" ? " each month" : ", once"}`;
}

/** A tenant's account between two dates: opening balance, every charge and payment, and the balance due. */
export async function tenantStatement(input: { leaseId: string; from: IsoDate; to: IsoDate }): Promise<ReportDocument> {
  const { leaseId, from, to } = input;
  if (from > to) throw new RangeError("From must be on or before To");
  const today = todayInNairobi();
  const year = to.slice(0, 4);

  const [head, leases, totals, entries, open, resolver, rentFor, held] = await Promise.all([
    header("STM"),
    query<{ id: string; startDate: IsoDate; endDate: IsoDate | null; status: string; rentAmount: number; tenantName: string; phone: string; unitCode: string; buildingId: string; buildingName: string }>(sql`
      select l.id, l.start_date::text as "startDate", l.end_date::text as "endDate", l.status, l.rent_amount as "rentAmount",
        t.full_name as "tenantName", t.phone, u.code as "unitCode", b.id as "buildingId", b.name as "buildingName"
      from leases l join tenants t on t.id = l.tenant_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
      where l.id = ${leaseId}`),
    query<{ opening: number; closing: number; today: number }>(sql`
      select coalesce(sum(debit - credit) filter (where entry_date < ${from}), 0)::int as opening,
        coalesce(sum(debit - credit) filter (where entry_date <= ${to}), 0)::int as closing,
        coalesce(sum(debit - credit), 0)::int as today
      from ledger_entries where lease_id = ${leaseId}`),
    query<{ date: IsoDate; type: string; reference: string; debit: number; credit: number; description: string | null; invoiceNumber: string | null; receiptNumber: string | null; mpesaReceipt: string | null; channel: string | null; bankReference: string | null }>(sql`
      select e.entry_date::text as date, e.type, e.reference, e.debit, e.credit, il.description, i.number as "invoiceNumber",
        r.number as "receiptNumber", p.mpesa_receipt as "mpesaReceipt", p.channel, p.raw->>'reference' as "bankReference"
      from ledger_entries e
      left join invoice_lines il on il.id = e.invoice_line_id left join invoices i on i.id = il.invoice_id
      left join payments p on p.id = e.payment_id left join receipts r on r.payment_id = p.id
      where e.lease_id = ${leaseId} and e.entry_date >= ${from} and e.entry_date <= ${to}
      order by e.entry_date, e.created_at, case when e.debit > 0 then 0 else 1 end, e.id`),
    query<{ dueDate: IsoDate; open: number }>(sql`
      select i.due_date::text as "dueDate", ${LINE_OPEN}::int as open
      from invoice_lines il join invoices i on i.id = il.invoice_id
      where i.lease_id = ${leaseId} and ${LINE_OPEN} > 0`),
    loadPolicyResolver(),
    loadRentResolver(getDatabase(), [leaseId]),
    depositHeld(leaseId),
  ]);
  const lease = leases[0];
  if (!lease) throw new StatementLeaseMissing("Tenancy not found");
  const sums = totals[0] ?? { opening: 0, closing: 0, today: 0 };
  const settings = resolver(lease.buildingId, earliest(to, today)).settings;

  // ---- Rows: opening balance, entries with a running balance, totals ----
  let balance = sums.opening;
  let charges = 0;
  let paid = 0;
  const rows: Row[] = [
    { date: text(formatDate(from)), description: text("Opening balance"), charges: money(null), payments: money(null), balance: money(sums.opening, { brackets: true }) },
  ];
  for (const entry of entries) {
    balance += entry.debit - entry.credit;
    charges += entry.debit;
    paid += entry.credit;
    let description: Row["description"];
    if (entry.type === "payment") {
      const channel = entry.channel ? CHANNEL_LABELS[entry.channel] ?? entry.channel : "Payment";
      const sub = [entry.receiptNumber, entry.mpesaReceipt ?? (entry.bankReference ? `Ref ${entry.bankReference}` : null)].filter(Boolean).join(" · ");
      description = text(`Payment, ${channel}`, { sub: sub || undefined });
    } else if (entry.type === "charge") {
      description = text(entry.description ?? entry.reference, { sub: entry.invoiceNumber ?? undefined });
    } else {
      description = text(entry.reference);
    }
    rows.push({
      date: text(formatDate(entry.date)),
      description,
      charges: money(entry.debit || null),
      payments: money(entry.credit || null, { tone: "green" }),
      balance: money(balance, { brackets: true }),
    });
  }
  assertEqual("tenant-statement", "running balance vs ledger", balance, sums.closing);
  assertEqual("tenant-statement", "opening + charges − payments", sums.opening + charges - paid, sums.closing);

  const table: Table = {
    id: "statement",
    title: "Statement",
    hideTitle: true,
    columns: [
      { key: "date", label: "Date", type: "text", width: "14%" },
      { key: "description", label: "Description", type: "text" },
      { key: "charges", label: "Charges", type: "money", sum: true, width: "15%" },
      { key: "payments", label: "Payments", type: "money", sum: true, width: "15%" },
      { key: "balance", label: "Balance", type: "money", width: "16%" },
    ],
    rows,
    total: { label: "Totals for the period", cells: { balance: money(sums.closing, { brackets: true }) } },
  };

  // ---- Balance by age, today (credit = what is paid but not yet used on a bill) ----
  const bands = { current: 0, d60: 0, d90: 0, over: 0 };
  for (const line of open) {
    const late = daysBetween(line.dueDate, today);
    if (late <= 30) bands.current += line.open;
    else if (late <= 60) bands.d60 += line.open;
    else if (late <= 90) bands.d90 += line.open;
    else bands.over += line.open;
  }
  const openTotal = bands.current + bands.d60 + bands.d90 + bands.over;
  const credit = sums.today - openTotal;

  const nextDue = open.map((line) => line.dueDate).sort()[0] ?? nextDueDate(today, settings.dueDay);
  const rent = rentFor(lease.id, earliest(to, today), lease.rentAmount);
  const range = `${formatDate(from)} – ${formatDate(to)}`;
  const balanceLabel = sums.closing < 0 ? "Credit" : "Balance due";

  const document: ReportDocument = {
    ...head,
    slug: "tenant-statement",
    kind: "Tenant statement",
    title: lease.tenantName,
    period: range,
    filter: `${lease.unitCode} · ${lease.buildingName}`,
    summary: [
      { label: balanceLabel, value: kes(sums.closing, { credit: true }), number: sums.closing, money: true, note: `At ${formatDate(to)}` },
      { label: "Charges", value: kes(charges), number: charges, money: true, note: `${entries.filter((entry) => entry.debit > 0).length} in the period` },
      { label: "Payments", value: kes(paid), number: paid, money: true, note: `${entries.filter((entry) => entry.type === "payment").length} received` },
      { label: "Deposit held", value: kes(held), number: held, money: true, note: "Not part of the balance" },
    ],
    sections: [
      {
        id: "parties",
        blocks: [
          {
            kind: "facts",
            boxes: [
              {
                title: "Tenant",
                facts: [
                  ["Name", lease.tenantName],
                  ["Unit", `${lease.unitCode}, ${lease.buildingName}`],
                  ["Phone", formatPhone(lease.phone)],
                  ["Tenant since", formatDate(lease.startDate)],
                  ...(lease.status === "ended" && lease.endDate ? ([["Moved out", formatDate(lease.endDate)]] as [string, string][]) : []),
                ],
              },
              {
                title: "Lease terms",
                facts: [
                  ["Rent", `${kes(rent)} a month`],
                  ["Due day", `${ordinal(settings.dueDay)} of each month`],
                  ["Water rate", settings.water.ratePerUnit ? `${kes(settings.water.ratePerUnit)} a unit` : "Not charged"],
                  ["Late fee", lateFee(settings.penalty)],
                  ["Deposit held", kes(held)],
                ],
              },
            ],
          },
        ],
      },
      { id: "entries", title: "Account", blocks: [{ kind: "table", table }] },
    ],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          large: true,
          lines: [
            { label: `Opening balance, ${formatDate(from)}`, op: "+", amount: sums.opening },
            { label: "Charges", op: "+", amount: charges },
            { label: "Payments", op: "−", amount: paid },
          ],
          result: { label: `${balanceLabel}, ${formatDate(to)}`, amount: sums.closing, credit: true },
          aside: {
            title: "How to pay",
            facts: [
              ["M-Pesa Paybill", head.landlord.paybill],
              ["Account number", lease.unitCode],
              ["Due date", formatDate(nextDue)],
            ],
          },
        },
        {
          kind: "bands",
          title: `Balance by age today, ${formatDate(today)}`,
          bands: [
            { label: "Current", amount: bands.current },
            { label: "31–60 days", amount: bands.d60 },
            { label: "61–90 days", amount: bands.d90 },
            { label: "Over 90 days", amount: bands.over },
            ...(credit !== 0 ? [{ label: credit < 0 ? "Credit" : "Other", amount: credit, credit: true }] : []),
          ],
        },
      ],
    },
    fileName: `rentpay-statement-${lease.unitCode.toLowerCase()}-${from}-to-${to}`,
  };
  return finalise(document);
}

const earliest = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

function nextDueDate(today: IsoDate, dueDay: number): IsoDate {
  const thisMonth = dateInPeriod(periodOf(today), dueDay);
  return thisMonth >= today ? thisMonth : dateInPeriod(addMonthsToPeriod(periodOf(today), 1), dueDay);
}

function ordinal(day: number): string {
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

function formatPhone(phone: string): string {
  const local = phone.startsWith("254") ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}

