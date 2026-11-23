import "server-only";
import { depositRegister, occupancy, RENTAL_INCOME_TAX_PERCENT, rentalIncomeForTax } from "@/services/reports";
import { formatDate, formatPeriod, todayInNairobi, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { assertEqual, count, kes, money, tableTotal, text, type ReportDocument, type Table, type Tone } from "../document";
import { finalise, header } from "./common";

/** Days each unit was let or empty between two dates, and the rent lost while empty. */
export async function occupancyReport(input: { from: IsoDate; to: IsoDate }): Promise<ReportDocument> {
  const [head, result] = await Promise.all([header("OCC"), occupancy({ from: input.from, to: input.to })]);
  const table: Table = {
    id: "occupancy",
    title: "Occupancy",
    hideTitle: true,
    columns: [
      { key: "unit", label: "Unit", type: "text", width: "12%" },
      { key: "building", label: "Building", type: "text" },
      { key: "tenant", label: "Tenant now", type: "text" },
      { key: "occupied", label: "Days let", type: "count", sum: true, width: "11%" },
      { key: "vacant", label: "Days empty", type: "count", sum: true, width: "11%" },
      { key: "lost", label: "Rent lost", type: "money", sum: true, width: "14%" },
    ],
    rows: result.rows.map((row) => ({
      unit: text(row.unitCode, { italic: !row.currentTenant }),
      building: text(row.buildingName),
      tenant: row.currentTenant ? text(row.currentTenant) : text("", { tag: { label: "Vacant", tone: "vacant" } }),
      occupied: count(row.occupiedDays),
      vacant: count(row.vacantDays || null),
      lost: money(row.rentLost || null, { tone: row.rentLost ? "red" : undefined }),
    })),
    total: { label: `Total, ${result.rows.length} units` },
  };
  const lost = tableTotal(table, "lost");
  assertEqual("occupancy", "rent lost", lost, result.totals.rentLost);
  const range = `${formatDate(result.from)} – ${formatDate(result.to)}`;
  return finalise({
    ...head,
    slug: "occupancy",
    kind: "Occupancy report",
    title: "Occupancy",
    period: range,
    filter: "All buildings",
    summary: [
      { label: "Occupied now", value: `${result.totals.occupiedNow} of ${result.totals.units}`, number: result.totals.occupiedNow, note: `${result.totals.occupancyRate ?? 0}% let` },
      { label: "Rent lost", value: kes(lost), number: lost, money: true, note: "While units stood empty" },
      { label: "Days empty", value: String(result.totals.vacantDays), number: result.totals.vacantDays, note: "Across all units" },
      { label: "Vacant now", value: String(result.totals.units - result.totals.occupiedNow), number: result.totals.units - result.totals.occupiedNow, note: "Units without a tenant" },
    ],
    sections: [{ id: "units", title: "Units", blocks: [{ kind: "table", table }] }],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: [
            { label: `Days empty (${result.totals.vacantDays}) × each unit's daily rent`, op: "+", amount: lost },
          ],
          result: { label: `Rent lost to vacancy, ${range}`, amount: lost },
          notes: ["Daily rent is the unit's monthly rent × 12 ÷ 365."],
        },
      ],
    },
    fileName: `rentpay-occupancy-${result.from}-to-${result.to}`,
  });
}

/** Rent received per month in a year, less deposits, with the Monthly Rental Income tax estimate. */
export async function rentalIncomeTaxReport(input: { year: number }): Promise<ReportDocument> {
  const [head, result] = await Promise.all([header("TAX"), rentalIncomeForTax({ year: input.year })]);
  const table: Table = {
    id: "months",
    title: "Months",
    hideTitle: true,
    columns: [
      { key: "month", label: "Month", type: "text" },
      { key: "received", label: "Received", type: "money", sum: true, width: "17%" },
      { key: "deposits", label: "Less deposits", type: "money", sum: true, width: "17%" },
      { key: "gross", label: "Gross rent", type: "money", sum: true, width: "17%" },
      { key: "tax", label: `Tax at ${RENTAL_INCOME_TAX_PERCENT}%`, type: "money", sum: true, width: "17%" },
    ],
    rows: result.rows.map((row) => ({
      month: text(formatPeriod(row.month as BillingPeriod)),
      received: money(row.received || null),
      deposits: money(row.deposits || null),
      gross: money(row.grossRent || null),
      tax: money(row.estimatedTax || null),
    })),
    total: { label: `Total ${input.year}` },
  };
  const received = tableTotal(table, "received");
  const deposits = tableTotal(table, "deposits");
  const gross = tableTotal(table, "gross");
  const tax = tableTotal(table, "tax");
  assertEqual("rental-income-tax", "received − deposits", received - deposits, gross);
  return finalise({
    ...head,
    slug: "rental-income-tax",
    kind: "Tax report",
    title: "Rental income for tax",
    period: String(input.year),
    filter: "All buildings",
    note: `Estimated Monthly Rental Income tax at ${RENTAL_INCOME_TAX_PERCENT}% of gross rent, worked out month by month. Check the current KRA rate before filing.`,
    summary: [
      { label: "Estimated tax", value: kes(tax), number: tax, money: true, note: `${RENTAL_INCOME_TAX_PERCENT}% of gross rent` },
      { label: "Gross rent", value: kes(gross), number: gross, money: true, note: "Received less deposits" },
      { label: "Received", value: kes(received), number: received, money: true, note: "Matched payments" },
      { label: "Deposits", value: kes(deposits), number: deposits, money: true, note: "Not rental income" },
    ],
    sections: [{ id: "months", title: "By month", blocks: [{ kind: "table", table }] }],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: [
            { label: "Payments received", op: "+", amount: received },
            { label: "Less deposits", op: "−", amount: deposits },
            { label: "Gross rent", op: "", amount: null, display: kes(gross) },
          ],
          result: { label: `Gross rent, ${input.year}`, amount: gross },
          notes: [`Estimated tax: ${kes(tax)} (each month's ${RENTAL_INCOME_TAX_PERCENT}% rounded to the shilling).`],
        },
      ],
    },
    fileName: `rentpay-rental-income-tax-${input.year}`,
  });
}

/** Deposits charged, held, applied at move-out and refunded, per tenancy. */
export async function depositsReport(): Promise<ReportDocument> {
  const [head, result] = await Promise.all([header("DEP"), depositRegister()]);
  const statusTone: Record<string, Tone> = { active: "paid", notice: "partial", ended: "neutral" };
  const table: Table = {
    id: "deposits",
    title: "Deposits",
    hideTitle: true,
    columns: [
      { key: "tenant", label: "Tenant", type: "text" },
      { key: "status", label: "Tenancy", type: "text", width: "11%" },
      { key: "charged", label: "Charged", type: "money", sum: true, width: "12%" },
      { key: "held", label: "Held", type: "money", sum: true, width: "12%" },
      { key: "applied", label: "Applied", type: "money", sum: true, width: "12%" },
      { key: "refunded", label: "Refunded", type: "money", sum: true, width: "12%" },
      { key: "toRefund", label: "To refund", type: "money", sum: true, width: "12%" },
    ],
    rows: result.rows.map((row) => ({
      tenant: text(row.tenantName, { sub: `${row.unitCode}${row.moveOutDate ? ` · moved out ${formatDate(row.moveOutDate as IsoDate)}` : ""}` }),
      status: text("", { tag: { label: row.leaseStatus === "ended" ? "Ended" : row.leaseStatus === "notice" ? "Notice" : "Active", tone: statusTone[row.leaseStatus] ?? "neutral" } }),
      charged: money(row.charged || null),
      held: money(row.held || null),
      applied: money(row.applied || null),
      refunded: money(row.refunded || null),
      toRefund: money(row.stillToRefund || null, { tone: row.stillToRefund ? "red" : undefined }),
    })),
    total: { label: `Total, ${result.rows.length} tenancies` },
  };
  const held = tableTotal(table, "held");
  const toRefund = tableTotal(table, "toRefund");
  assertEqual("deposits", "held", held, result.totals.held);
  return finalise({
    ...head,
    slug: "deposits",
    kind: "Deposit register",
    title: "Deposits",
    period: `At ${formatDate(todayInNairobi())}`,
    filter: "All buildings",
    summary: [
      { label: "Deposits held", value: kes(held), number: held, money: true, note: "Owed back to tenants" },
      { label: "Charged", value: kes(tableTotal(table, "charged")), number: tableTotal(table, "charged"), money: true, note: "All tenancies" },
      { label: "Refunded", value: kes(tableTotal(table, "refunded")), number: tableTotal(table, "refunded"), money: true, note: "After move-out" },
      { label: "Still to refund", value: kes(toRefund), number: toRefund, money: true, note: toRefund ? "Tenants who have left" : "Nothing outstanding" },
    ],
    sections: [{ id: "deposits", title: "Tenancies", blocks: [{ kind: "table", table }] }],
    closing: {
      id: "summary",
      title: "Summary",
      blocks: [
        {
          kind: "calc",
          lines: [
            { label: "Held for current and past tenants", op: "+", amount: held },
            { label: "Of which still to refund to tenants who left", op: "", amount: null, display: kes(toRefund) },
          ],
          result: { label: "Deposits held", amount: held },
          notes: ["Deposits are not income. Held = deposit paid − applied at move-out − refunded."],
        },
      ],
    },
    fileName: `rentpay-deposits`,
  });
}
