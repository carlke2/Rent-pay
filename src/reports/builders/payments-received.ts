import "server-only";
import { sql } from "drizzle-orm";
import { formatPeriod, parseMpesaTimestamp, type BillingPeriod } from "@/utilities/dates";
import { assertEqual, count, kes, money, tableTotal, text, type Column, type ReportDocument, type Row, type Table, type Tone } from "../document";
import { at, buildingLabel, CHANNEL_LABELS, finalise, firstName, header, nairobiDate, periodBounds, query, shortDate } from "./common";

type PaymentRow = {
  id: string;
  paidAt: Date;
  channel: string;
  amount: number;
  mpesaReceipt: string | null;
  bankReference: string | null;
  matchStatus: "matched" | "unmatched" | "reversed";
  accountReference: string | null;
  payerName: string | null;
  receiptNumber: string | null;
  unitCode: string | null;
  buildingId: string | null;
  buildingName: string | null;
  tenantName: string | null;
  source: string | null;
};

const MPESA = new Set(["stk", "paybill"]);

const COLUMNS: Column[] = [
  { key: "date", label: "Date", type: "text", width: "11%" },
  { key: "receipt", label: "Receipt", type: "text", width: "14%" },
  { key: "tenant", label: "Tenant", type: "text" },
  { key: "unit", label: "Unit", type: "text", width: "11%" },
  { key: "channel", label: "Channel", type: "text", width: "19%" },
  { key: "amount", label: "Amount", type: "money", sum: true, width: "15%" },
];

/** The M-Pesa code or bank reference shown under the channel. */
function reference(row: PaymentRow): string | undefined {
  return row.mpesaReceipt ?? (row.bankReference ? `Ref ${row.bankReference}` : undefined);
}

/**
 * Money received in a month: one section per building, then corrections (moved, duplicate, refunded, reversed),
 * which never change the building totals, then the summary and the check against Safaricom's own records.
 */
export async function paymentsReceived(input: { period: BillingPeriod; buildingId?: string | null }): Promise<ReportDocument> {
  const period = input.period;
  const year = period.slice(0, 4);
  const [start, end] = periodBounds(period);
  const buildingOnly = input.buildingId ? sql`and b.id = ${input.buildingId}` : sql``;

  const [head, filter, payments, refunds, callbacks] = await Promise.all([
    header("PAY"),
    buildingLabel(input.buildingId),
    query<PaymentRow>(sql`
      select p.id, p.paid_at as "paidAt", p.channel, p.amount, p.mpesa_receipt as "mpesaReceipt", p.raw->>'reference' as "bankReference",
        p.match_status as "matchStatus", p.account_reference as "accountReference", p.payer_name as "payerName", p.raw->>'source' as source,
        r.number as "receiptNumber", u.code as "unitCode", b.id as "buildingId", b.name as "buildingName", t.full_name as "tenantName"
      from payments p
      left join leases l on l.id = p.lease_id left join units u on u.id = l.unit_id left join buildings b on b.id = u.building_id
      left join tenants t on t.id = l.tenant_id left join receipts r on r.payment_id = p.id
      where p.paid_at >= ${at(start)} and p.paid_at < ${at(end)} and p.source = 'live' and p.channel <> 'opening'
        and p.match_status in ('matched', 'unmatched', 'reversed') ${buildingOnly}
      order by b.name nulls last, p.paid_at, p.id`),
    query<{ amount: number; refundedOn: string; method: string | null; reference: string | null; tenantName: string; unitCode: string; moveOutDate: string | null }>(sql`
      select (a.after->>'amount')::int as amount, a.after->>'refundedOn' as "refundedOn", a.after->>'method' as method, a.after->>'reference' as reference,
        t.full_name as "tenantName", u.code as "unitCode", l.move_out_date::text as "moveOutDate"
      from audit_log a join leases l on l.id::text = a.entity_id join units u on u.id = l.unit_id join buildings b on b.id = u.building_id
      join tenants t on t.id = l.tenant_id
      where a.action = 'lease.deposit_refund' and a.after->>'refundedOn' >= ${`${period}-01`} and a.after->>'refundedOn' < ${`${period}-32`} ${buildingOnly}
      order by a.after->>'refundedOn'`),
    // What Safaricom told us: Paybill confirmations and successful STK results around the month (filtered by
    // transaction time below). The same M-Pesa code twice is a duplicate.
    query<{ kind: string; code: string | null; amount: string | null; time: string | null; resultCode: string | null }>(sql`
      select c.kind,
        case when c.kind = 'stk' then (select i->>'Value' from jsonb_array_elements(c.payload->'Body'->'stkCallback'->'CallbackMetadata'->'Item') i where i->>'Name' = 'MpesaReceiptNumber')
             else c.payload->>'TransID' end as code,
        case when c.kind = 'stk' then (select i->>'Value' from jsonb_array_elements(c.payload->'Body'->'stkCallback'->'CallbackMetadata'->'Item') i where i->>'Name' = 'Amount')
             else c.payload->>'TransAmount' end as amount,
        case when c.kind = 'stk' then (select i->>'Value' from jsonb_array_elements(c.payload->'Body'->'stkCallback'->'CallbackMetadata'->'Item') i where i->>'Name' = 'TransactionDate')
             else c.payload->>'TransTime' end as time,
        c.payload->'Body'->'stkCallback'->>'ResultCode' as "resultCode"
      from payment_callbacks c
      where c.kind in ('stk', 'paybill_confirmation')
        and c.received_at >= ${at(new Date(start.getTime() - 86_400_000))} and c.received_at < ${at(new Date(end.getTime() + 7 * 86_400_000))}`),
  ]);

  const counted = payments.filter((row) => row.matchStatus !== "reversed");
  const reversed = payments.filter((row) => row.matchStatus === "reversed");
  const ids = payments.map((row) => row.id);
  const [reasons, moves] = ids.length
    ? await Promise.all([
        query<{ paymentId: string; reason: string | null; createdAt: Date }>(sql`
          select entity_id as "paymentId", reason, created_at as "createdAt" from audit_log
          where action = 'payment.reverse' and entity_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
        query<{ paymentId: string; createdAt: Date }>(sql`
          select entity_id as "paymentId", created_at as "createdAt" from audit_log
          where action = 'payment.assign' and entity_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
      ])
    : [[], []];

  // ---- Sections per building (unmatched money last) ----
  const groups = new Map<string, { title: string; rows: PaymentRow[] }>();
  for (const row of counted) {
    const key = row.buildingId ?? "unmatched";
    const group = groups.get(key) ?? { title: row.buildingName ?? "Not yet matched to a unit", rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const paymentRow = (row: PaymentRow): Row => ({
    date: text(shortDate(nairobiDate(row.paidAt), year)),
    receipt: text(row.receiptNumber ?? "—"),
    tenant: row.tenantName ? text(row.tenantName) : text(row.payerName ?? "Unknown payer", { sub: `Account “${row.accountReference || "blank"}”` }),
    unit: text(row.unitCode ?? "—"),
    channel: text(CHANNEL_LABELS[row.channel] ?? row.channel, { sub: reference(row) }),
    amount: money(row.amount),
  });
  const buildingTables: Table[] = [...groups.entries()].map(([key, group]) => ({
    id: `building-${key}`,
    title: group.title,
    hideTitle: true,
    columns: COLUMNS,
    rows: group.rows.map(paymentRow),
    total: { label: `Total ${group.title}` },
  }));

  const gross = counted.reduce((sum, row) => sum + row.amount, 0);
  const refunded = refunds.reduce((sum, row) => sum + row.amount, 0);
  const net = gross - refunded;
  assertEqual("payments-received", "building sections vs payments", buildingTables.reduce((sum, table) => sum + tableTotal(table, "amount"), 0), gross);

  // ---- Safaricom's records ----
  type Seen = { code: string; amount: number; times: number };
  const seen = new Map<string, Seen>();
  for (const callback of callbacks) {
    if (!callback.code || !callback.time || (callback.kind === "stk" && callback.resultCode !== "0")) continue;
    const when = parseMpesaTimestamp(callback.time);
    if (when < start || when >= end) continue;
    const entry = seen.get(callback.code) ?? { code: callback.code, amount: Math.round(Number(callback.amount ?? 0)), times: 0 };
    entry.times += 1;
    seen.set(callback.code, entry);
  }
  // Payments imported from an M-Pesa statement are Safaricom's record too.
  for (const row of payments) {
    if (row.source === "statement" && row.mpesaReceipt && !seen.has(row.mpesaReceipt)) seen.set(row.mpesaReceipt, { code: row.mpesaReceipt, amount: row.amount, times: 1 });
  }

  // ---- Corrections ----
  type Correction = { date: string; sort: string; tone: Tone; tag: string; sentence: string; effect: number | null; effectLabel?: string };
  const corrections: Correction[] = [];
  const who = (row: PaymentRow) => [row.tenantName, row.unitCode].filter(Boolean).join(" ") || row.payerName || "an unknown payer";
  for (const row of reversed) {
    const audit = reasons.find((item) => item.paymentId === row.id);
    const when = audit ? nairobiDate(audit.createdAt) : nairobiDate(row.paidAt);
    const channel = (CHANNEL_LABELS[row.channel] ?? row.channel).toLowerCase().replace("m-pesa", "M-Pesa");
    corrections.push({
      date: shortDate(when, year),
      sort: when,
      tone: "reversed",
      tag: "Reversed",
      sentence: `${kes(row.amount)} ${channel} from ${who(row)} on ${shortDate(nairobiDate(row.paidAt), year)} was reversed${audit?.reason ? `: ${audit.reason.replace(/\.$/, "").toLowerCase()}` : ""}. Not counted.`,
      effect: null,
      effectLabel: "Excluded",
    });
  }
  for (const move of moves) {
    const row = payments.find((item) => item.id === move.paymentId);
    if (!row || row.matchStatus === "reversed") continue;
    const when = nairobiDate(move.createdAt);
    corrections.push({
      date: shortDate(when, year),
      sort: when,
      tone: "partial",
      tag: "Moved",
      sentence: `${kes(row.amount)} paid to account “${row.accountReference || "blank"}”, which matches no unit, moved to ${who(row)}. Counted once, under ${firstName(row.tenantName)}.`,
      effect: null,
      effectLabel: "No change",
    });
  }
  for (const entry of seen.values()) {
    if (entry.times < 2) continue;
    const row = payments.find((item) => item.mpesaReceipt === entry.code);
    const when = row ? nairobiDate(row.paidAt) : `${period}-01`;
    corrections.push({
      date: shortDate(when, year),
      sort: when,
      tone: "neutral",
      tag: "Duplicate",
      sentence: `Safaricom sent M-Pesa ${entry.code} (${kes(entry.amount)}${row ? `, ${who(row)}` : ""}) ${entry.times === 2 ? "twice" : `${entry.times} times`}. Counted once.`,
      effect: null,
      effectLabel: "Excluded",
    });
  }
  for (const refund of refunds) {
    corrections.push({
      date: shortDate(refund.refundedOn, year),
      sort: refund.refundedOn,
      tone: "credit",
      tag: "Refunded",
      sentence: `Deposit balance of ${kes(refund.amount)} refunded to ${refund.tenantName} ${refund.unitCode}${refund.moveOutDate ? ` after moving out on ${shortDate(refund.moveOutDate, year)}` : ""}${refund.method ? ` by ${refund.method}` : ""}${refund.reference ? ` (${refund.reference})` : ""}.`,
      effect: -refund.amount,
    });
  }
  corrections.sort((a, b) => a.sort.localeCompare(b.sort));
  const correctionsTable: Table = {
    id: "corrections",
    title: "Corrections",
    hideTitle: true,
    columns: [
      { key: "date", label: "Date", type: "text", width: "11%" },
      { key: "type", label: "Type", type: "text", width: "14%" },
      { key: "what", label: "What happened", type: "text" },
      { key: "effect", label: "Effect", type: "money", sum: true, width: "15%" },
    ],
    rows: corrections.map((item) => ({
      date: text(item.date),
      type: text("", { tag: { label: item.tag, tone: item.tone } }),
      what: text(item.sentence),
      effect: money(item.effect, { label: item.effectLabel }),
    })),
    total: { label: "Effect on net received" },
    emptyText: "No corrections this period.",
  };
  const notCounted = corrections.filter((item) => item.tag !== "Refunded").length;

  // ---- Summary tables ----
  const channels = ["stk", "paybill", "bank", "cash", ...new Set(counted.map((row) => row.channel).filter((channel) => !["stk", "paybill", "bank", "cash"].includes(channel)))];
  const byChannel: Table = {
    id: "by-channel",
    title: "By channel",
    columns: [
      { key: "channel", label: "Channel", type: "text" },
      { key: "count", label: "Payments", type: "count", sum: true },
      { key: "amount", label: "Amount", type: "money", sum: true },
    ],
    rows: channels.map((channel) => {
      const rows = counted.filter((row) => row.channel === channel);
      return { channel: text(CHANNEL_LABELS[channel] ?? channel), count: count(rows.length), amount: money(rows.reduce((sum, row) => sum + row.amount, 0)) };
    }),
    total: { label: "Total" },
  };
  const byBuilding: Table = {
    id: "by-building",
    title: "By building",
    columns: [
      { key: "building", label: "Building", type: "text" },
      { key: "count", label: "Payments", type: "count", sum: true },
      { key: "amount", label: "Amount", type: "money", sum: true },
    ],
    rows: [...groups.values()].map((group) => ({
      building: text(group.title),
      count: count(group.rows.length),
      amount: money(group.rows.reduce((sum, row) => sum + row.amount, 0)),
    })),
    total: { label: "Total" },
  };
  assertEqual("payments-received", "by channel vs payments", tableTotal(byChannel, "amount"), gross);
  assertEqual("payments-received", "by building vs payments", tableTotal(byBuilding, "amount"), gross);

  // ---- Reconciliation against Safaricom ----
  const label = formatPeriod(period);
  const ours = payments.filter((row) => MPESA.has(row.channel) && row.mpesaReceipt);
  const oursTotal = ours.reduce((sum, row) => sum + row.amount, 0);
  const theirs = [...seen.values()];
  const theirsTotal = theirs.reduce((sum, entry) => sum + entry.amount, 0);
  let reconcile: Extract<ReportDocument["closing"]["blocks"][number], { kind: "reconcile" }>;
  if (input.buildingId) {
    reconcile = { kind: "reconcile", status: "none", text: "The check against Safaricom's M-Pesa records covers all buildings: choose All buildings to see it." };
  } else if (theirs.length === 0 && ours.length === 0) {
    reconcile = { kind: "reconcile", status: "none", text: `No M-Pesa payments in ${label}.` };
  } else if (theirsTotal === oursTotal && theirs.length === ours.length) {
    reconcile = { kind: "reconcile", status: "match", text: `Matches the M-Pesa Paybill records from Safaricom for ${label}: ${kes(theirsTotal)} across ${theirs.length} transaction${theirs.length === 1 ? "" : "s"}.` };
  } else {
    reconcile = {
      kind: "reconcile",
      status: "mismatch",
      text: `Does not match the M-Pesa Paybill records from Safaricom for ${label}: Safaricom ${kes(theirsTotal)} across ${theirs.length}, RentPay ${kes(oursTotal)} across ${ours.length}. Difference ${kes(Math.abs(theirsTotal - oursTotal))}${theirsTotal === oursTotal ? ` (${Math.abs(theirs.length - ours.length)} transactions)` : ""}.`,
    };
  }

  const mpesaAmount = counted.filter((row) => MPESA.has(row.channel)).reduce((sum, row) => sum + row.amount, 0);
  const mpesaShare = gross > 0 ? Math.round((mpesaAmount / gross) * 100) : 0;
  const document: ReportDocument = {
    ...head,
    slug: "payments-received",
    kind: "Payments report",
    title: "Payments received",
    period: label,
    filter,
    summary: [
      { label: "Net received", value: kes(net), number: net, money: true, note: refunded ? `After ${kes(refunded)} refunded` : "No refunds this month" },
      { label: "Number of payments", value: String(counted.length), number: counted.length, note: `${groups.size} ${groups.size === 1 ? "section" : "sections"}` },
      { label: "Via M-Pesa", value: kes(mpesaAmount), number: mpesaAmount, money: true, note: `${mpesaShare}% of money received` },
      { label: "Corrections", value: String(corrections.length), number: corrections.length, note: corrections.length ? "Listed after the buildings" : "None this month" },
    ],
    sections: [
      ...buildingTables.map((table) => ({ id: table.id, title: table.title, blocks: [{ kind: "table" as const, table }] })),
      ...(buildingTables.length ? [] : [{ id: "none", title: "Payments", blocks: [{ kind: "note" as const, text: `No payments received in ${label}.` }] }]),
      {
        id: "corrections",
        title: "Corrections this period",
        blocks: [
          { kind: "note", text: "Moved, duplicate, refunded and reversed payments. None of these are in the building totals above." },
          { kind: "table", table: correctionsTable },
        ],
      },
    ],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        { kind: "pair", tables: [byChannel, byBuilding] },
        {
          kind: "calc",
          lines: [
            { label: `Payments received (${counted.length})`, op: "+", amount: gross },
            { label: "Less refunds paid out", op: "−", amount: refunded },
            { label: `Moved, duplicates and reversals (${notCounted})`, op: "", amount: null, display: "Not counted" },
          ],
          result: { label: `Net rent received, ${label}`, amount: net },
        },
        reconcile,
        { kind: "signatures", labels: ["Prepared by", "Checked by"] },
      ],
    },
    fileName: `rentpay-payments-received-${period}`,
  };
  return finalise(document);
}
