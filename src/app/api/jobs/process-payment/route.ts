import { NextResponse } from "next/server";
import { hasCronSecret } from "@/authentication/secrets";
import { runJob } from "@/services/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by QStash. A 500 makes QStash retry. */
export async function POST(request: Request) {
  if (!hasCronSecret(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const payload: unknown = await request.json();
    const result = await runJob("process-payment", payload);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("process-payment job failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Job failed" }, { status: 500 });
  }
}
