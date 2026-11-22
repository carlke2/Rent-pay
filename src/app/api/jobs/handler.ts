import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { hasCronSecret } from "@/authentication/secrets";
import { getEnvironment } from "@/configuration/environment";
import { runJob, type JobName } from "@/services/jobs";
import { isIsoDate } from "@/utilities/dates";
import { logError } from "@/utilities/log";

/**
 * GET (Vercel Cron / Cloud Scheduler) and POST (queue) handler for a job.
 * Requires Authorization: Bearer ${CRON_SECRET}. In the sandbox only, ?date=YYYY-MM-DD pretends it is that day.
 * The JSON body (POST) and query parameters are passed to the job; failures return 500 so queues retry.
 */
export function jobHandler(name: JobName, queryKeys: readonly string[] = []) {
  return async function handle(request: Request) {
    if (!hasCronSecret(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const url = new URL(request.url);
    const payload: Record<string, unknown> = {};
    if (request.method === "POST") {
      const text = await request.text();
      if (text) {
        try {
          Object.assign(payload, JSON.parse(text));
        } catch {
          return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
        }
      }
    }
    for (const key of queryKeys) {
      const value = url.searchParams.get(key);
      if (value !== null) payload[key] = value;
    }

    const date = url.searchParams.get("date") ?? (typeof payload.date === "string" ? payload.date : null);
    delete payload.date;
    if (date !== null) {
      if (getEnvironment().MPESA_ENV !== "sandbox") {
        return NextResponse.json({ error: "date can only be set in the sandbox" }, { status: 400 });
      }
      if (!isIsoDate(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
      payload.today = date;
    }

    try {
      return NextResponse.json({ ok: true, job: name, result: await runJob(name, payload) });
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({ ok: false, job: name, error: "Invalid input", issues: error.issues }, { status: 400 });
      }
      logError(`${name} job failed`, error);
      return NextResponse.json(
        { ok: false, job: name, error: error instanceof Error ? error.message : "Job failed" },
        { status: 500 },
      );
    }
  };
}
