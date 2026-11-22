import { NextResponse } from "next/server";
import { readSession } from "@/authentication/session";
import { REPORT_NAMES, runReport, toCsv, type ReportName } from "@/services/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV download of any table report, for signed-in landlords only. */
export async function GET(request: Request) {
  if (!(await readSession("landlord"))) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const parameters = Object.fromEntries(new URL(request.url).searchParams.entries());
  const report = parameters.report;
  if (!report || !(REPORT_NAMES as readonly string[]).includes(report)) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  try {
    const result = await runReport(report as ReportName, parameters);
    return new Response(toCsv(result.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Report failed" }, { status: 400 });
  }
}
