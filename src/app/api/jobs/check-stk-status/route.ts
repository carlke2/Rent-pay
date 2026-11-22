import { NextResponse } from "next/server";
import { hasCronSecret } from "@/authentication/secrets";
import { runJob } from "@/services/jobs";
import { logError } from "@/utilities/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Up to 10 Daraja checks spaced 1 s apart. */
export const maxDuration = 60;

/** GET for Vercel Cron / Cloud Scheduler, POST for the queue. */
async function handle(request: Request) {
  if (!hasCronSecret(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await runJob("check-stk-status", {});
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logError("check-stk-status job failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Job failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
