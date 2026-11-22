import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";
import { DarajaError } from "@/adapters/mpesa";
import { formToObject } from "@/app/admin/actions/run";
import type { ActionState } from "@/components/shared/action-types";
import { ServiceError } from "@/services/errors";
import type { TenantLease } from "@/services/portal";
import { currentTenantLease } from "../current-lease";
import { logError } from "@/utilities/log";

function fieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.map(String).join(".") || "form"] ??= issue.message;
  return errors;
}

type Handler<Input> = (input: Input, context: { tenantId: string; lease: TenantLease; actor: string }) => Promise<{ message?: string; data?: Record<string, unknown> }>;

/** Every tenant Server Action: session and lease, zod validation, the service call, plain-language errors. */
export async function runTenantAction<Schema extends z.ZodType>(schema: Schema, formData: FormData, handler: Handler<z.output<Schema>>): Promise<ActionState> {
  const { tenantId, lease } = await currentTenantLease();
  const at = Date.now();
  if (!lease) return { status: "error", message: "We couldn't find your lease. Please contact your landlord.", at };
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) return { status: "error", message: "Please check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), at };
  try {
    const result = await handler(parsed.data, { tenantId, lease, actor: `tenant:${tenantId}` });
    revalidatePath("/tenants", "layout");
    return { status: "success", message: result.message, data: result.data, at };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ServiceError || error instanceof RangeError) return { status: "error", message: error.message, at };
    if (error instanceof DarajaError) return { status: "error", message: "We couldn't reach M-Pesa. Please try again, or pay from the M-Pesa menu.", at };
    logError("Tenant action failed", error);
    return { status: "error", message: "Something went wrong. Please try again.", at };
  }
}
