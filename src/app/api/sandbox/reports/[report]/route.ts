import { z } from "zod";
import { ServiceError } from "@/services/errors";
import { dashboard, REPORT_NAMES, runReport, toCsv, type ReportName } from "@/services/reports";
import { todayInNairobi } from "@/utilities/dates";
import { billingPeriod, isoDate, sandboxRoute } from "../../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sandbox/reports/{name}?…  Add format=csv for the rows as CSV (not for the dashboard).
 * Names: dashboard, collection-summary, arrears-aging, occupancy, income-and-expenses,
 * rental-income-for-tax, payment-log, deposit-register.
 */
export const GET = sandboxRoute<RouteContext<"/api/sandbox/reports/[report]">>(async (request, context) => {
  const { report } = await context.params;
  const query = new URL(request.url).searchParams;
  const param = (key: string) => query.get(key) ?? undefined;
  const today = isoDate.parse(param("date") ?? todayInNairobi());
  z.uuid().optional().parse(param("buildingId"));
  const from = () => isoDate.parse(param("from"));
  const to = () => isoDate.parse(param("to"));

  if (report === "dashboard") return dashboard({ today });
  if (!(REPORT_NAMES as readonly string[]).includes(report)) throw new ServiceError(`Unknown report "${report}"`);
  // Validate the shared parameters, then let runReport do the rest.
  if (param("from")) from();
  if (param("to")) to();
  if (param("period")) billingPeriod.parse(param("period"));
  const result = await runReport(report as ReportName, Object.fromEntries(query.entries()) as Record<string, string>);

  if (param("format") === "csv") {
    return new Response(toCsv(result.rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report}.csv"` },
    });
  }
  return result;
});
