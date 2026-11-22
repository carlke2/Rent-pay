import { NextResponse } from "next/server";
import { usePayLink } from "@/authentication/pay-links";
import { createSession } from "@/authentication/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** M-Pesa's per-transaction ceiling. */
const MAXIMUM_AMOUNT = 250_000;

/**
 * "Pay now" on the bill card (a POST form, so link previews can't trigger it): signs the tenant in with the
 * card's pay-link code and opens the pay page with the amount filled in.
 */
export async function POST(request: Request, context: RouteContext<"/bill/[code]/pay">) {
  const { code } = await context.params;
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const link = await usePayLink(code);
  if (!link) return NextResponse.redirect(new URL("/tenants/login?link=expired", url), 303);
  await createSession({ role: "tenant", subject: link.tenantId, leaseId: link.leaseId });

  const form = await request.formData().catch(() => null);
  const amount = Number(form?.get("amount"));
  const target = new URL("/tenants/pay", url);
  if (Number.isSafeInteger(amount) && amount >= 1 && amount <= MAXIMUM_AMOUNT) target.searchParams.set("amount", String(amount));
  return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
