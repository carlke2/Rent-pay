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
      { status: "unavailable", database: "unreachable", time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
