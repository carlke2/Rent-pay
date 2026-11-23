import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getEnvironment } from "@/configuration/environment";
import { getDatabase } from "@/database/client";
import { addMonthsToPeriod, firstDayOfPeriod, formatDate, formatNairobiDateTime, nairobiParts, startOfNairobiDay, toNairobiDate, type BillingPeriod, type IsoDate } from "@/utilities/dates";
import { finalise, type ReportDocument } from "../document";

export async function query<T>(statement: SQL): Promise<T[]> {
  return [...(await getDatabase().execute(statement))] as T[];
}

/** Raw queries get timestamps as ISO text. */
export const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

/** Start (inclusive) and end (exclusive) instants of a period in Nairobi time. */
export function periodBounds(period: BillingPeriod): [Date, Date] {
  return [startOfNairobiDay(firstDayOfPeriod(period)), startOfNairobiDay(firstDayOfPeriod(addMonthsToPeriod(period, 1)))];
}

export const LINE_ALLOCATED = sql.raw(`(select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = il.id)`);
export const LINE_OPEN = sql.raw(`(il.amount - il.waived_amount - (select coalesce(sum(a.amount), 0) from allocations a where a.invoice_line_id = il.id))`);

/** "3 Nov" (same year as the report) or "3 Nov 2025". */
export function shortDate(date: IsoDate, year?: string): string {
  const full = formatDate(date);
  return year && date.startsWith(year) ? full.replace(` ${year}`, "") : full;
}

export const nairobiDate = (instant: Date | string): IsoDate => toNairobiDate(new Date(instant));

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "the tenant";
}

export const CHANNEL_LABELS: Record<string, string> = {
  stk: "M-Pesa app",
  paybill: "M-Pesa Paybill",
  bank: "Bank",
  cash: "Cash",
  cheque: "Cheque",
  opening: "Opening balance",
};

export type Header = Pick<ReportDocument, "generatedAt" | "generatedLabel" | "number" | "landlord">;

/** Landlord details and a report number like RP-PAY-20261123-1432. */
export async function header(code: string): Promise<Header> {
  const [owner] = await query<{ name: string; email: string }>(sql`select name, email from landlord order by created_at limit 1`);
  const now = new Date();
  const parts = nairobiParts(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    generatedAt: now.toISOString(),
    generatedLabel: formatNairobiDateTime(now),
    number: `RP-${code}-${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}`,
    landlord: { name: owner?.name ?? getEnvironment().APP_NAME, paybill: getEnvironment().MPESA_SHORTCODE, email: owner?.email ?? "" },
  };
}

export async function buildingLabel(buildingId: string | null | undefined): Promise<string> {
  if (!buildingId) return "All buildings";
  const [row] = await query<{ name: string }>(sql`select name from buildings where id = ${buildingId}`);
  return row?.name ?? "All buildings";
}

export { finalise };
