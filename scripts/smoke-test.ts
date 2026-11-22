/**
 * Smoke test: requests every page and read-only endpoint against a running server and reports
 * status, time and any page that rendered its error screen. Changes no data and sends no SMS or STK.
 *
 *   npm run smoke                       # against http://localhost:3000
 *   SMOKE_BASE_URL=http://localhost:3100 npm run smoke
 *
 * Exits 1 if any check fails.
 */
import { and, eq, inArray } from "drizzle-orm";
import { signSessionToken, SESSION_COOKIE_NAMES } from "@/authentication/tokens";
import { getEnvironment } from "@/configuration/environment";
import { closeDatabase, getDatabase } from "@/database/client";
import { invoices, landlord, leases, tenants, units } from "@/database/schema";
import { REPORT_NAMES } from "@/services/reports";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS ?? 3000);

type Check = {
  path: string;
  as?: "landlord" | "tenant" | "cron";
  method?: "GET" | "POST";
  /** Acceptable statuses (default 200). */
  expect?: number[];
  /** Page HTML must not contain the route error screen. */
  page?: boolean;
};

/** Text that means a page hit its error boundary or crashed while rendering. */
const BROKEN_MARKERS = ["This page couldn&#x27;t load", "This page couldn't load", "Application error", 'id="__next_error__"'];

async function context() {
  const db = getDatabase();
  const [owner] = await db.select({ id: landlord.id }).from(landlord).limit(1);
  if (!owner) throw new Error("No landlord in the database: run npm run db:seed first");
  const [lease] = await db
    .select({ tenantId: tenants.id, leaseId: leases.id, unitId: units.id, buildingId: units.buildingId })
    .from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(inArray(leases.status, ["active", "notice"]), eq(tenants.portalAccess, true)))
    .limit(1);
  if (!lease) throw new Error("No current lease to test the tenant portal with");
  const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.leaseId, lease.leaseId)).limit(1);
  return {
    ...lease,
    invoiceId: invoice?.id,
    cookies: {
      landlord: `${SESSION_COOKIE_NAMES.landlord}=${await signSessionToken({ role: "landlord", subject: owner.id })}`,
      tenant: `${SESSION_COOKIE_NAMES.tenant}=${await signSessionToken({ role: "tenant", subject: lease.tenantId, leaseId: lease.leaseId })}`,
    },
  };
}

function checks(ctx: Awaited<ReturnType<typeof context>>): Check[] {
  const admin = (path: string): Check => ({ path, as: "landlord", page: true });
  const tenant = (path: string): Check => ({ path, as: "tenant", page: true });
  const list: Check[] = [
    // Public
    { path: "/", expect: [200, 307, 308], page: true },
    { path: "/admin/login", page: true },
    { path: "/tenants/login", page: true },
    { path: "/api/health" },
    { path: "/receipts/not-a-real-token", expect: [200, 404], page: false },
    { path: "/pay-link/not-a-real-token", expect: [200, 302, 303, 307, 400, 404, 410] },
    // Guards: signed-out visitors are redirected to sign in
    { path: "/admin", expect: [307] },
    { path: "/tenants", expect: [307] },
    // Landlord app
    admin("/admin"),
    admin("/admin/buildings"),
    admin(`/admin/buildings/${ctx.buildingId}`),
    admin(`/admin/units/${ctx.unitId}`),
    admin("/admin/tenants"),
    admin(`/admin/tenants/${ctx.tenantId}`),
    admin("/admin/invoices"),
    admin("/admin/payments"),
    admin("/admin/expenses"),
    admin("/admin/meter-readings"),
    admin("/admin/messages"),
    admin("/admin/move-in"),
    admin("/admin/move-out"),
    admin("/admin/reports"),
    admin("/admin/settings"),
    admin("/admin/settings/policies"),
    admin("/admin/settings/templates"),
    admin("/admin/settings/integrations"),
    ...REPORT_NAMES.map((report) => admin(`/admin/reports?report=${report}`)),
    ...REPORT_NAMES.map((report): Check => ({ path: `/admin/reports/export?report=${report}`, as: "landlord" })),
    // Tenant portal
    tenant("/tenants"),
    tenant("/tenants/bills"),
    ...(ctx.invoiceId ? [tenant(`/tenants/bills/${ctx.invoiceId}`)] : []),
    tenant("/tenants/pay"),
    tenant("/tenants/receipts"),
    tenant("/tenants/statement"),
    tenant("/tenants/report-payment"),
    tenant("/tenants/profile"),
    tenant("/tenants/more"),
    // Jobs and callbacks refuse callers without the secret / key (never run here: they send SMS)
    { path: "/api/jobs/generate-invoices", expect: [401] },
    { path: "/api/jobs/send-reminders", expect: [401] },
    { path: "/api/jobs/apply-penalties", expect: [401] },
    { path: "/api/jobs/daily-summary", expect: [401] },
    { path: "/api/jobs/check-stk-status", expect: [401] },
    { path: "/api/jobs/send-notification", method: "POST", expect: [401] },
    { path: "/api/jobs/process-payment", method: "POST", expect: [401] },
    { path: "/api/payments/stk-result", method: "POST", expect: [401, 403] },
    { path: "/api/payments/paybill-validation", method: "POST", expect: [401, 403] },
    { path: "/api/payments/paybill-confirmation", method: "POST", expect: [401, 403] },
  ];
  if (getEnvironment().MPESA_ENV === "sandbox") {
    list.push(
      { path: "/api/sandbox/invoices", as: "cron" },
      { path: "/api/sandbox/expenses", as: "cron" },
      { path: "/api/sandbox/policies", as: "cron" },
      { path: `/api/sandbox/leases/${ctx.leaseId}/statement`, as: "cron" },
      ...["dashboard", ...REPORT_NAMES].map((report): Check => ({ path: `/api/sandbox/reports/${report}`, as: "cron" })),
      { path: "/api/sandbox/invoices", expect: [401] },
    );
  }
  return list;
}

async function run(check: Check, ctx: Awaited<ReturnType<typeof context>>) {
  const headers: Record<string, string> = {};
  if (check.as === "landlord") headers.Cookie = ctx.cookies.landlord;
  if (check.as === "tenant") headers.Cookie = ctx.cookies.tenant;
  if (check.as === "cron") headers.Authorization = `Bearer ${getEnvironment().CRON_SECRET}`;
  if (check.method === "POST") headers["Content-Type"] = "application/json";

  const started = performance.now();
  let status = 0;
  let problem: string | null = null;
  try {
    const response = await fetch(`${BASE}${check.path}`, {
      method: check.method ?? "GET",
      headers,
      body: check.method === "POST" ? "{}" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    status = response.status;
    const body = await response.text();
    const expected = check.expect ?? [200];
    if (!expected.includes(status)) {
      const location = response.headers.get("location");
      problem = `expected ${expected.join("/")}${location ? ` (redirected to ${location})` : ""}: ${body.replace(/\s+/g, " ").slice(0, 160)}`;
    } else if (check.page && status === 200) {
      const marker = BROKEN_MARKERS.find((text) => body.includes(text));
      if (marker) problem = `rendered an error screen (${marker})`;
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  return { ...check, status, ms: Math.round(performance.now() - started), problem };
}

const ctx = await context();
const list = checks(ctx);
console.log(`Smoke test: ${list.length} checks against ${BASE}\n`);

const results = [];
for (const check of list) {
  const result = await run(check, ctx);
  results.push(result);
  const mark = result.problem ? "FAIL" : result.ms > SLOW_MS ? "SLOW" : " ok ";
  const who = check.as ? ` [${check.as}]` : "";
  console.log(`${mark}  ${String(result.status).padStart(3)}  ${String(result.ms).padStart(6)} ms  ${check.method ?? "GET"} ${check.path}${who}`);
  if (result.problem) console.log(`        ${result.problem}`);
}

const failed = results.filter((result) => result.problem);
const slow = results.filter((result) => !result.problem && result.ms > SLOW_MS);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed, ${slow.length} slower than ${SLOW_MS} ms`);
await closeDatabase();
process.exit(failed.length ? 1 : 0);
