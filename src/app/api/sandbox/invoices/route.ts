import { listInvoices } from "@/services/billing";
import { currentPeriod, todayInNairobi } from "@/utilities/dates";
import { billingPeriod, isoDate, sandboxRoute } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Invoices for ?period= (default: current) with lines, open amounts and status as of ?date= (default: today). */
export const GET = sandboxRoute(async (request) => {
  const url = new URL(request.url);
  const period = billingPeriod.parse(url.searchParams.get("period") ?? currentPeriod());
  const today = isoDate.parse(url.searchParams.get("date") ?? todayInNairobi());
  return { period, today, invoices: await listInvoices({ period, today }) };
});
