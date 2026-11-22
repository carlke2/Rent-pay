import "server-only";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { findPayLinkLease } from "@/authentication/pay-links";
import { getEnvironment } from "@/configuration/environment";
import { graceEndsOn } from "@/core/billing";
import { getDatabase } from "@/database/client";
import { invoiceLines, invoices, landlord, leases, payments, receipts, units } from "@/database/schema";
import { addDays, daysBetween, formatDate, formatNairobiDateTime, formatPeriod, todayInNairobi, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { formatShillings } from "@/utilities/money";
import { loadPolicyResolver } from "./policies";
import { leaseBalance } from "./tenancy";

export type BillCardType = "bill" | "reminder" | "overdue" | "paid";

export type BillCard = {
  type: BillCardType;
  pill: string;
  title: string;
  amount: number;
  detail: string;
  rows: { label: string; value: string }[];
  /** "pay": POST sign-in with the code, then the pay page with `payAmount` filled in. "link": a plain link. */
  action: { kind: "pay"; label: string; payAmount: number } | { kind: "link"; label: string; href: string } | null;
  footer: string;
};

const monthName = (period: BillingPeriod) => formatPeriod(period).replace(/\s+\d{4}$/, "");
/** "5 Dec" */
const shortDate = (date: IsoDate) => formatDate(date).replace(/\s+\d{4}$/, "");

function lineLabel(line: { type: string; description: string }): string {
  if (line.type === "rent") return "Rent";
  if (line.type === "water") {
    const units = /\((\d+)\s*units?\)/i.exec(line.description);
    if (units) return `Water · ${units[1]} units`;
    return /standing/i.test(line.description) ? "Water standing charge" : "Water";
  }
  if (line.type === "penalty") return "Late fee";
  if (line.type === "deposit") return "Deposit";
  return line.description;
}

function channelRef(row: { channel: string; mpesaReceipt: string | null; raw: unknown }): string {
  if (row.channel === "cash") return "Cash";
  if (row.channel === "bank") {
    const reference = row.raw && typeof row.raw === "object" && "reference" in row.raw ? String((row.raw as { reference?: unknown }).reference ?? "").trim() : "";
    return reference ? `Bank ref ${reference}` : "Bank";
  }
  return row.mpesaReceipt ? `M-Pesa ${row.mpesaReceipt}` : "M-Pesa";
}

/**
 * The public message card behind host/bill/{code}: the lease's CURRENT state, so the same link stays right
 * after part payments. Null when the code is unknown or expired. Read-only (doesn't use up or sign in).
 */
export async function getBillCard(code: string): Promise<BillCard | null> {
  const leaseId = await findPayLinkLease(code);
  if (!leaseId) return null;

  const database = getDatabase();
  const today = todayInNairobi();
  const [[lease], balance, lineRows, [lastPayment], resolver, [owner]] = await Promise.all([
    database
      .select({ unitCode: units.code, buildingId: units.buildingId })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, leaseId))
      .limit(1),
    leaseBalance(leaseId),
    database
      .select({
        invoiceId: invoices.id,
        period: invoices.period,
        dueDate: invoices.dueDate,
        type: invoiceLines.type,
        description: invoiceLines.description,
        amount: sql<number>`(${invoiceLines.amount} - ${invoiceLines.waivedAmount})::int`,
        open: sql<number>`(${invoiceLines.amount} - ${invoiceLines.waivedAmount} - (select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = ${invoiceLines.id}))::int`,
      })
      .from(invoices)
      .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
      .where(eq(invoices.leaseId, leaseId))
      .orderBy(desc(invoices.period), asc(invoiceLines.createdAt))
      .limit(300),
    database
      .select({
        amount: payments.amount,
        paidAt: payments.paidAt,
        channel: payments.channel,
        mpesaReceipt: payments.mpesaReceipt,
        raw: payments.raw,
        receiptNumber: receipts.number,
        receiptCode: sql<string>`coalesce(${receipts.shortCode}, ${receipts.token})`,
      })
      .from(payments)
      .innerJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(and(eq(payments.leaseId, leaseId), ne(payments.matchStatus, "reversed")))
      .orderBy(desc(payments.paidAt))
      .limit(1),
    loadPolicyResolver(database),
    database.select({ phone: landlord.phone }).from(landlord).orderBy(asc(landlord.createdAt)).limit(1),
  ]);
  if (!lease) return null;

  const env = getEnvironment();
  const settings = resolver(lease.buildingId, today).settings;

  // Group lines into invoices (newest period first).
  type Invoice = { id: string; period: BillingPeriod; dueDate: IsoDate; total: number; open: number; lines: { type: string; description: string; amount: number }[] };
  const byId = new Map<string, Invoice>();
  for (const row of lineRows) {
    let invoice = byId.get(row.invoiceId);
    if (!invoice) {
      invoice = { id: row.invoiceId, period: row.period, dueDate: row.dueDate, total: 0, open: 0, lines: [] };
      byId.set(row.invoiceId, invoice);
    }
    invoice.total += row.amount;
    invoice.open += row.open;
    invoice.lines.push({ type: row.type, description: row.description, amount: row.amount });
  }
  const invoiceList = [...byId.values()];
  const latest = invoiceList[0] ?? null;
  const oldestOpen = [...invoiceList].filter((invoice) => invoice.open > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;

  // ---- Paid --------------------------------------------------------------------------------
  if (balance <= 0) {
    const month = latest ? monthName(latest.period) : null;
    const rows: BillCard["rows"] = [];
    if (lastPayment) rows.push({ label: "Receipt", value: lastPayment.receiptNumber });
    if (month) rows.push({ label: month, value: "Fully paid" });
    if (balance < 0) rows.push({ label: "Credit", value: formatShillings(-balance) });
    return {
      type: "paid",
      pill: "Paid",
      title: "Payment received",
      amount: lastPayment?.amount ?? 0,
      detail: lastPayment ? `${formatNairobiDateTime(lastPayment.paidAt)} · ${channelRef(lastPayment)}` : `Nothing to pay · ${lease.unitCode}`,
      rows,
      action: lastPayment ? { kind: "link", label: "View receipt", href: `/receipts/${lastPayment.receiptCode}` } : null,
      footer: "Thank you.",
    };
  }

  const focus = oldestOpen ?? latest;
  const payAction = (label: string) => ({ kind: "pay" as const, label, payAmount: balance });

  // ---- Overdue -----------------------------------------------------------------------------
  if (oldestOpen && graceEndsOn(oldestOpen.dueDate, settings.graceDays) < today) {
    const days = Math.max(1, daysBetween(oldestOpen.dueDate, today));
    const rows: BillCard["rows"] = [{ label: "Balance", value: formatShillings(balance) }];
    const penalty = settings.penalty;
    if (penalty.type !== "none" && (penalty.type === "flat" ? penalty.amount > 0 : penalty.percent > 0)) {
      rows.push({
        label: `Late fee from ${shortDate(addDays(graceEndsOn(oldestOpen.dueDate, settings.graceDays), 1))}`,
        value: penalty.type === "flat" ? formatShillings(penalty.amount) : `${penalty.percent}%`,
      });
    }
    return {
      type: "overdue",
      pill: "Overdue",
      title: "Payment overdue",
      amount: balance,
      detail: `${days} ${days === 1 ? "day" : "days"} overdue · ${lease.unitCode}`,
      rows,
      action: payAction("Pay now"),
      footer: owner?.phone ? `Need more time? Call 0${owner.phone.replace(/^254/, "")}` : "Need more time? Talk to your landlord.",
    };
  }

  // ---- Reminder ----------------------------------------------------------------------------
  const paidSoFar = focus ? focus.total - focus.open : 0;
  const daysToDue = focus ? daysBetween(today, focus.dueDate) : null;
  if (focus && (paidSoFar > 0 || (daysToDue !== null && daysToDue <= 2))) {
    const title =
      focus.dueDate < today
        ? `Rent was due on ${shortDate(focus.dueDate)}`
        : focus.dueDate === today
          ? "Rent due today"
          : focus.dueDate === addDays(today, 1)
            ? "Rent due tomorrow"
            : `Rent due on ${shortDate(focus.dueDate)}`;
    return {
      type: "reminder",
      pill: "Reminder",
      title,
      amount: balance,
      detail: `${monthName(focus.period)} bill · ${lease.unitCode}`,
      rows: [
        { label: `${monthName(focus.period)} bill`, value: formatShillings(focus.total) },
        { label: "Paid so far", value: formatShillings(paidSoFar) },
      ],
      action: payAction(`Pay ${formatShillings(balance)}`),
      footer: "Already paid? It can take a minute to show.",
    };
  }

  // ---- Bill --------------------------------------------------------------------------------
  const rows: BillCard["rows"] = (focus?.lines ?? []).filter((line) => line.amount > 0).map((line) => ({ label: lineLabel(line), value: formatShillings(line.amount) }));
  const earlier = focus ? balance - focus.open : 0;
  if (earlier > 0) rows.push({ label: "Earlier balance", value: formatShillings(earlier) });
  if (earlier < 0) rows.push({ label: "Credit applied", value: `-${formatShillings(-earlier)}` });
  return {
    type: "bill",
    pill: "New bill",
    title: focus ? `Your ${monthName(focus.period)} bill` : "Your bill",
    amount: balance,
    detail: focus ? `Due ${shortDate(focus.dueDate)} · ${lease.unitCode}` : lease.unitCode,
    rows,
    action: payAction("Pay now"),
    footer: `Or Paybill ${env.MPESA_SHORTCODE}, account ${lease.unitCode}`,
  };
}
