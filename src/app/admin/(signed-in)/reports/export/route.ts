import { NextResponse } from "next/server";
import { readSession } from "@/authentication/session";
import { buildReport, isReportSlug, readReportParameters, ReportNeedsInput } from "@/reports";
import { reportWorkbook } from "@/reports/excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Excel download of a report (the same figures as the screen and the PDF), for signed-in landlords only. */
export async function GET(request: Request) {
  if (!(await readSession("landlord"))) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (!isReportSlug(query.report)) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  try {
    const document = await buildReport(query.report, readReportParameters(query.report, query));
    const body = await reportWorkbook(document);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${document.fileName}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ReportNeedsInput || error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
