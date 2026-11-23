import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase } from "@/database/client";
import { logError } from "@/utilities/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await getDatabase().execute(sql`select 1`);
    return NextResponse.json(
      { status: "ok", database: "ok", latencyMs: Date.now() - started, time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError("Health check failed", error);
    return NextResponse.json(
      // The driver's error code only (e.g. CONNECTION_CLOSED, CONNECT_TIMEOUT): no message, host or data.
      { status: "unavailable", database: "unreachable", code: errorCode(error), latencyMs: Date.now() - started, time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function errorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return /^[A-Z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN";
}
