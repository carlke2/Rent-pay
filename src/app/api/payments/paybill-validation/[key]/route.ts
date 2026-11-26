import { paybillValidation } from "../../paybill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Key as the last path segment: the form registered with Daraja, which drops query strings from C2B URLs. */
export async function POST(request: Request, context: RouteContext<"/api/payments/paybill-validation/[key]">) {
  const { key } = await context.params;
  return paybillValidation(request, key);
}
