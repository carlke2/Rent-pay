import { NextResponse } from "next/server";
import { usePayLink } from "@/authentication/pay-links";
import { createSession } from "@/authentication/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-tap link from SMS: checks the token, signs the tenant in to that lease and opens the pay page. */
export async function GET(request: Request, context: RouteContext<"/pay-link/[token]">) {
  const { token } = await context.params;
  const url = new URL(request.url);
  const link = await usePayLink(token);
  if (!link) return NextResponse.redirect(new URL("/tenants/login?link=expired", url));
  await createSession({ role: "tenant", subject: link.tenantId, leaseId: link.leaseId });
  const next = url.searchParams.get("next") === "statement" ? "/tenants/statement" : "/tenants/pay";
  return NextResponse.redirect(new URL(next, url), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
