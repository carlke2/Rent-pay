import "server-only";
import { sql } from "drizzle-orm";
import { daysBetween, formatDate, formatNairobiDateTime, todayInNairobi, type IsoDate } from "@/utilities/dates";
import { assertEqual, kes, money, tableTotal, text, type ReportDocument, type Row, type Table } from "../document";
import { buildingLabel, finalise, header, LINE_OPEN, nairobiDate, query } from "./common";

type Line = { leaseId: string; tenantName: string; phone: string; unitCode: string; leaseStatus: string; dueDate: IsoDate; open: number };

const BANDS = [
  { key: "d30", label: "0–30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
  { key: "over", label: "Over 90 days" },
] as const;
type BandKey = (typeof BANDS)[number]["key"];

/** Overdue amounts per tenant, by how long each bill has been overdue, largest first. */
export async function arrearsByAge(input: { buildingId?: string | null }): Promise<ReportDocument> {
  const today = todayInNairobi();
  const buildingOnly = input.buildingId ? sql`and b.id = ${input.buildingId}` : sql``;
  const [head, filter, lines, lastPayments, reminders, tenancies] = await Promise.all([
    header("ARR"),
    buildingLabel(input.buildingId),
    query<Line>(sql`
      select l.id as "leaseId", t.full_name as "tenantName", t.phone, u.code as "unitCode", l.status as "leaseStatus",
        i.due_date::text as "dueDate", ${LINE_OPEN}::int as open
      from invoice_lines il join invoices i on i.id = il.invoice_id
      join leases l on l.id = i.lease_id join tenants t on t.id = l.tenant_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
      where i.due_date <= ${today} and ${LINE_OPEN} > 0 ${buildingOnly}`),
    query<{ leaseId: string; paidAt: Date; amount: number }>(sql`
      select distinct on (p.lease_id) p.lease_id as "leaseId", p.paid_at as "paidAt", p.amount
      from payments p where p.match_status = 'matched' and p.lease_id is not null
      order by p.lease_id, p.paid_at desc`),
    query<{ sentAt: Date | null; tenants: number }>(sql`
      with latest as (select max(created_at) as at from messages where template like 'reminder%' and status in ('sent', 'delivered', 'queued'))
      select (select at from latest) as "sentAt",
        (select count(distinct lease_id)::int from messages, latest where template like 'reminder%' and created_at >= latest.at - interval '1 hour' and created_at <= latest.at) as tenants`),
    query<{ count: number }>(sql`
      select count(*)::int as count from leases l join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
      where l.status in ('active', 'notice') ${buildingOnly}`),
  ]);

  type Tenant = { leaseId: string; name: string; unitCode: string; phone: string; status: string; bands: Record<BandKey, number>; total: number; oldest: IsoDate };
  const byLease = new Map<string, Tenant>();
  for (const line of lines) {
    const tenant = byLease.get(line.leaseId) ?? {
      leaseId: line.leaseId,
      name: line.tenantName,
      unitCode: line.unitCode,
      phone: line.phone,
      status: line.leaseStatus,
      bands: { d30: 0, d60: 0, d90: 0, over: 0 },
      total: 0,
      oldest: line.dueDate,
    };
    const late = daysBetween(line.dueDate, today);
    const band: BandKey = late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "over";
    tenant.bands[band] += line.open;
    tenant.total += line.open;
    if (line.dueDate < tenant.oldest) tenant.oldest = line.dueDate;
    byLease.set(line.leaseId, tenant);
  }
  const tenants = [...byLease.values()].sort((a, b) => b.total - a.total || a.unitCode.localeCompare(b.unitCode));
  const tone = (band: BandKey) => (band === "d60" ? "amber" : band === "d30" ? undefined : "red");

  const rows: Row[] = tenants.map((tenant) => {
    const last = lastPayments.find((payment) => payment.leaseId === tenant.leaseId);
    const phone = tenant.phone.startsWith("254") ? `0${tenant.phone.slice(3)}` : tenant.phone;
    return {
      tenant: text(tenant.name, { sub: `${tenant.unitCode} · ${phone}${tenant.status === "ended" ? " · moved out" : ""}` }),
      ...Object.fromEntries(BANDS.map(({ key }) => [key, money(tenant.bands[key] || null, { tone: tone(key) })])),
      total: money(tenant.total),
      last: last ? text(formatDate(nairobiDate(last.paidAt)), { sub: kes(last.amount) }) : text("None"),
    };
  });
  const table: Table = {
    id: "arrears",
    title: "Arrears by age",
    hideTitle: true,
    columns: [
      { key: "tenant", label: "Tenant", type: "text" },
      ...BANDS.map(({ key, label }) => ({ key, label: label.replace(" days", ""), type: "money" as const, sum: true, width: "11%" })),
      { key: "total", label: "Total", type: "money", sum: true, width: "12%" },
      { key: "last", label: "Last payment", type: "text", width: "14%" },
    ],
    rows,
    total: { label: `Total, ${tenants.length} ${tenants.length === 1 ? "tenant" : "tenants"}` },
    emptyText: "Nobody is in arrears.",
  };
  const total = tableTotal(table, "total");
  const bandTotals = BANDS.map(({ key, label }) => ({ label, amount: tableTotal(table, key) }));
  assertEqual("arrears", "bands vs total", bandTotals.reduce((sum, band) => sum + band.amount, 0), total);
  assertEqual("arrears", "rows vs open bills", total, lines.reduce((sum, line) => sum + line.open, 0));

  const over60 = bandTotals[2]!.amount + bandTotals[3]!.amount;
  const oldest = tenants.map((tenant) => tenant.oldest).sort()[0];
  const reminder = reminders[0];
  const current = tenancies[0]?.count ?? 0;

  const document: ReportDocument = {
    ...head,
    slug: "arrears",
    kind: "Arrears report",
    title: "Arrears by age",
    period: `At ${formatDate(today)}`,
    filter,
    note: "Payments are applied to the oldest bill first, so each amount sits in the age band of the bill it is still owed on.",
    summary: [
      { label: "Total arrears", value: kes(total), number: total, money: true, note: `Overdue bills at ${formatDate(today)}` },
      { label: "Tenants in arrears", value: String(tenants.length), number: tenants.length, note: `Of ${current} current tenancies` },
      { label: "Over 60 days", value: kes(over60), number: over60, money: true, note: total ? `${Math.round((over60 / total) * 100)}% of arrears` : "None" },
      { label: "Oldest bill", value: oldest ? `${daysBetween(oldest, today)} days` : "—", number: oldest ? daysBetween(oldest, today) : 0, note: oldest ? `Due ${formatDate(oldest)}` : "Nothing overdue" },
    ],
    sections: [{ id: "arrears", title: "Tenants in arrears", blocks: [{ kind: "table", table }] }],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: bandTotals.map((band) => ({ label: band.label, op: "+" as const, amount: band.amount })),
          result: { label: `Total arrears at ${formatDate(today)}`, amount: total },
          notes: [
            reminder?.sentAt
              ? `Reminders last sent ${formatNairobiDateTime(new Date(reminder.sentAt))} to ${reminder.tenants} ${reminder.tenants === 1 ? "tenant" : "tenants"}.`
              : "No reminders have been sent yet.",
          ],
        },
      ],
    },
    fileName: `rentpay-arrears-${today}`,
  };
  return finalise(document);
}
