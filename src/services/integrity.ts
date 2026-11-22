import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/database/client";

export type IntegrityIssue = { severity: "critical" | "warning"; check: string; message: string; table?: string };

/**
 * Every public table must have row level security on. With RLS on and no policies, the Supabase Data API
 * (anon / authenticated roles) sees nothing, while the app (postgres role, table owner) is unaffected.
 */
async function checkRowLevelSecurity(): Promise<IntegrityIssue[]> {
  const rows = await getDatabase().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by tablename`,
  );
  return [...rows].map(({ tablename }) => ({
    severity: "critical" as const,
    check: "row_level_security",
    table: tablename,
    message: `Table public.${tablename} has row level security disabled: it is readable and writable through the Supabase Data API.`,
  }));
}

/** Runs the integrity checks. Critical issues are logged; the job itself still succeeds so queues don't retry. */
export async function runIntegrityChecks(): Promise<{ ok: boolean; critical: number; issues: IntegrityIssue[] }> {
  const issues = await checkRowLevelSecurity();
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  for (const issue of issues) console.error(`[integrity-checks] ${issue.severity.toUpperCase()} ${issue.check}: ${issue.message}`);
  return { ok: critical === 0, critical, issues };
}
