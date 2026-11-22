import { z } from "zod";
import { CLAIM_METHODS, submitPaymentClaim } from "@/services/payments";
import { isoDate, readJson, sandboxRoute, wholeShillings } from "../guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  leaseId: z.uuid(),
  amount: wholeShillings.min(1),
  paidOn: isoDate,
  method: z.enum(CLAIM_METHODS),
  reference: z.string().nullish(),
  date: isoDate.optional(),
});

/** JSON, or multipart/form-data with the same fields plus an optional "slip" image (max 5 MB). */
export const POST = sandboxRoute(async (request) => {
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData();
    const slip = form.get("slip");
    const body = schema.parse({
      leaseId: form.get("leaseId"),
      amount: Number(form.get("amount")),
      paidOn: form.get("paidOn"),
      method: form.get("method"),
      reference: form.get("reference") || null,
      date: form.get("date") || undefined,
    });
    const { date, ...fields } = body;
    return submitPaymentClaim({
      ...fields,
      today: date,
      slipFile: slip instanceof File && slip.size > 0 ? { bytes: new Uint8Array(await slip.arrayBuffer()) } : null,
    });
  }
  const { date, ...fields } = schema.parse(await readJson(request));
  return submitPaymentClaim({ ...fields, today: date });
});
