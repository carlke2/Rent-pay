import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";
import { DarajaError } from "@/adapters/mpesa";
import { requireLandlord } from "@/authentication/roles";
import type { ActionState } from "@/components/shared/action-types";
import { ServiceError } from "@/services/errors";
import { isBillingPeriod, isIsoDate } from "@/utilities/dates";

// ---- zod helpers for form fields (FormData values are strings) ----

export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);
export const optionalText = (max = 200) => z.string().trim().max(max).optional();
export const shillings = (label = "Amount", minimum = 1) =>
  z.coerce
    .number({ error: `Enter ${label.toLowerCase()}` })
    .int(`${label} must be whole shillings`)
    .min(minimum, `${label} must be at least ${minimum}`);
export const wholeNumber = (label: string, minimum = 0) =>
  z.coerce.number({ error: `Enter ${label.toLowerCase()}` }).int(`${label} must be a whole number`).min(minimum, `${label} must be at least ${minimum}`);
export const isoDate = (label = "Date") => z.string({ error: `Choose ${label.toLowerCase()}` }).refine(isIsoDate, `Choose ${label.toLowerCase()}`);
export const billingPeriod = z.string({ error: "Choose a month" }).refine(isBillingPeriod, "Choose a month");
export const checkbox = z.preprocess((value) => value === "true" || value === "on", z.boolean());
export const identifier = (label = "Item") => z.uuid({ error: `Choose ${label.toLowerCase()}` });

/** FormData → plain object. Empty strings and empty files become undefined; "name[]" keys become arrays. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const cleaned = typeof value === "string" ? (value.trim() === "" ? undefined : value) : value.size === 0 ? undefined : value;
    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const list = (result[name] as unknown[] | undefined) ?? [];
      if (cleaned !== undefined) list.push(cleaned);
      result[name] = list;
    } else if (cleaned !== undefined) {
      result[key] = cleaned;
    }
  }
  return result;
}

function fieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

type Handler<Input> = (input: Input, context: { actor: string; landlordId: string }) => Promise<{ message: string; data?: Record<string, unknown> }>;

/**
 * Every landlord Server Action goes through here: session check, zod validation (errors per field),
 * the service call, friendly errors, and a refresh of the landlord screens.
 */
export async function runAction<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
  handler: Handler<z.output<Schema>>,
  options: { revalidate?: boolean } = {},
): Promise<ActionState> {
  const session = await requireLandlord();
  const at = Date.now();
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) {
    return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), at };
  }
  try {
    const result = await handler(parsed.data, { actor: `landlord:${session.subject}`, landlordId: session.subject });
    // Previews change nothing, so they skip the refresh.
    if (options.revalidate !== false) {
      revalidatePath("/admin", "layout");
      revalidateTag("admin-shell", "max");
    }
    return { status: "success", message: result.message, data: result.data, at };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrors(error), at };
    if (error instanceof ServiceError || error instanceof RangeError || error instanceof DarajaError) {
      return { status: "error", message: error.message, at };
    }
    console.error("Landlord action failed", error);
    return { status: "error", message: "Something went wrong. Please try again.", at };
  }
}
