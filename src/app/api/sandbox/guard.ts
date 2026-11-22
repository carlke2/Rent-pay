import "server-only";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { hasCronSecret } from "@/authentication/secrets";
import { eq } from "drizzle-orm";
import { getEnvironment } from "@/configuration/environment";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase } from "@/database/client";
import { units } from "@/database/schema";
import { ServiceError } from "@/services/errors";
import { isBillingPeriod, isIsoDate } from "@/utilities/dates";

/** Actor recorded in audit_log for sandbox calls. */
export const SANDBOX_ACTOR = "sandbox:api";

export const isoDate = z.string().refine(isIsoDate, "must be a YYYY-MM-DD date");
export const billingPeriod = z.string().refine(isBillingPeriod, "must be a YYYY-MM period");
export const wholeShillings = z.number().int("must be whole shillings");

type Handler<TContext> = (request: Request, context: TContext) => Promise<unknown>;

/**
 * Wraps a sandbox endpoint: 404 unless MPESA_ENV=sandbox, 401 without Authorization: Bearer ${CRON_SECRET}.
 * Returns the handler's result as JSON; bad input → 400, anything else → 500 with the message.
 */
export function sandboxRoute<TContext = unknown>(handler: Handler<TContext>) {
  return async function handle(request: Request, context: TContext) {
    if (getEnvironment().MPESA_ENV !== "sandbox") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!hasCronSecret(request)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    try {
      const result = await handler(request, context);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid input", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
          { status: 400 },
        );
      }
      if (error instanceof ServiceError || error instanceof RangeError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error("Sandbox endpoint failed", error);
      return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
    }
  };
}

/** Looks up a unit id by its code (any spacing/dashes). */
export async function unitIdFromCode(code: string): Promise<string> {
  const [unit] = await getDatabase().select({ id: units.id }).from(units).where(eq(units.normalisedCode, normaliseUnitCode(code)));
  if (!unit) throw new ServiceError(`Unknown unit code ${code}`);
  return unit.id;
}

/** Parses a JSON body (an empty body counts as {}). */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError("Body must be valid JSON");
  }
}
