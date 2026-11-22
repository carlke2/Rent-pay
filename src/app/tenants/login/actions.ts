"use server";

import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkLoginCode, issueLoginCode, LOGIN_CODE_LENGTH } from "@/authentication/login-codes";
import { clearPendingLogin, createSession, readPendingLogin, setPendingLogin } from "@/authentication/session";
import { checkUnitLogin, UNIT_LOGIN_WINDOW_MINUTES } from "@/authentication/unit-login";
import { getEnvironment } from "@/configuration/environment";
import { getDatabase } from "@/database/client";
import { leases, tenants } from "@/database/schema";
import { sendLoginCode } from "@/services/notifications";
import { listCurrentLeasesForTenant } from "@/services/tenancy";
import { maskPhone, normaliseKenyanPhone } from "@/utilities/phone";
import { logError } from "@/utilities/log";

export type TenantLoginState = {
  step: "phone" | "code" | "lease";
  /** On the first step: get an SMS code (always), or the phone + unit code test sign-in (sandbox only). */
  method?: "unit" | "code";
  /** Typed values kept after an error. */
  typedPhone?: string;
  typedUnit?: string;
  fieldErrors?: { phone?: string; unit?: string };
  phone?: string;
  maskedPhone?: string;
  leases?: { leaseId: string; label: string }[];
  error?: string;
  notice?: string;
  /** When the last code was sent (for the resend countdown). */
  codeSentAt?: number;
};

/** A tenant who may sign in: portal access on and a current (active or on-notice) lease. */
async function findEligibleTenant(phone: string): Promise<{ id: string } | null> {
  const [row] = await getDatabase()
    .select({ id: tenants.id })
    .from(tenants)
    .innerJoin(leases, eq(leases.tenantId, tenants.id))
    .where(and(eq(tenants.phone, phone), eq(tenants.portalAccess, true), inArray(leases.status, ["active", "notice"])))
    .limit(1);
  return row ?? null;
}

const codeSchema = z.string().trim().regex(new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`));

/** The visitor's network address (first X-Forwarded-For hop on hosted platforms), for rate limiting. */
async function clientAddress(): Promise<string | null> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || null;
}

/** The phone + unit code shortcut is a test sign-in: it only exists when MPESA_ENV=sandbox. */
function testSignInAllowed(): boolean {
  return getEnvironment().MPESA_ENV === "sandbox";
}

/**
 * Two ways in:
 * - phone number → 6-digit SMS code → (if more than one current lease) choose the lease → 30-day session.
 *   This is the only sign-in in live mode.
 * - sandbox only ("Test sign-in"): phone number + unit code (e.g. ROOM1K) → 30-day session for that unit's lease.
 *   Refused here on the server when MPESA_ENV=live, whatever the form sends.
 */
export async function tenantLogin(previous: TenantLoginState, formData: FormData): Promise<TenantLoginState> {
  const intent = formData.get("intent");

  if (intent === "restart") {
    await clearPendingLogin("tenant_choose_lease");
    return { step: "phone", method: previous.method === "unit" && testSignInAllowed() ? "unit" : "code" };
  }

  if (intent === "use-code" || intent === "use-unit") {
    return { step: "phone", method: intent === "use-unit" && testSignInAllowed() ? "unit" : "code" };
  }

  if (intent === "unit") {
    if (!testSignInAllowed()) {
      console.warn("[tenant login] phone + unit code sign-in refused: test sign-in is sandbox only");
      return { step: "phone", method: "code", error: "Sign in with the code we text to your phone." };
    }
    const typedPhone = String(formData.get("phone") ?? "").slice(0, 20);
    const typedUnit = String(formData.get("unit") ?? "").slice(0, 30);
    const phone = normaliseKenyanPhone(typedPhone);
    const fieldErrors: { phone?: string; unit?: string } = {};
    if (!phone) fieldErrors.phone = "Enter your number like 712 345 678.";
    if (!typedUnit.trim()) fieldErrors.unit = "Enter your unit number, like ROOM1K.";
    const back = { step: "phone" as const, method: "unit" as const, typedPhone, typedUnit };
    if (!phone || fieldErrors.unit) return { ...back, fieldErrors };

    let result;
    try {
      result = await checkUnitLogin({ phone, unitCode: typedUnit, address: await clientAddress() });
    } catch (error) {
      logError("Tenant unit sign-in failed", error);
      return { ...back, error: "We couldn't sign you in right now. Please try again." };
    }
    if (!result.ok) {
      return {
        ...back,
        error:
          result.reason === "locked"
            ? `Too many tries. Wait ${UNIT_LOGIN_WINDOW_MINUTES} minutes, or sign in with an SMS code instead.`
            : result.attemptsLeft > 0
              ? `That phone number and unit don't match. Check both and try again (${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left).`
              : `That phone number and unit don't match. Wait ${UNIT_LOGIN_WINDOW_MINUTES} minutes, or sign in with an SMS code instead.`,
      };
    }
    await createSession({ role: "tenant", subject: result.tenantId, leaseId: result.leaseId });
    redirect("/tenants");
  }

  if (intent === "request" || intent === "resend") {
    const typed = String(formData.get("phone") ?? "");
    const phone = normaliseKenyanPhone(typed);
    if (!phone) return { step: "phone", method: "code", error: "Enter your number like 712 345 678." };
    try {
      const tenant = await findEligibleTenant(phone);
      if (!tenant) return { step: "phone", method: "code", error: "We couldn't find that number. Check it, or contact your landlord." };
      const result = await issueLoginCode(phone, "tenant_login");
      if (!result.issued) {
        const message = "Too many codes requested. Try again in 15 minutes.";
        return intent === "resend" ? { ...previous, error: message } : { step: "phone", method: "code", error: message };
      }
      await sendLoginCode(phone, result.code);
    } catch (error) {
      logError("Tenant login code request failed", error);
      return { step: "phone", method: "code", error: "We couldn't send a code right now. Please try again." };
    }
    return { step: "code", phone, maskedPhone: maskPhone(phone), codeSentAt: Date.now(), notice: intent === "resend" ? "A new code is on its way." : undefined };
  }

  if (intent === "verify") {
    const phone = normaliseKenyanPhone(String(formData.get("phone") ?? ""));
    const code = codeSchema.safeParse(formData.get("code"));
    if (!phone) return { step: "phone", error: "Enter your mobile number again." };
    const codeState = { step: "code" as const, phone, maskedPhone: maskPhone(phone), codeSentAt: previous.codeSentAt };
    if (!code.success) return { ...codeState, error: `Enter all ${LOGIN_CODE_LENGTH} digits from the SMS.` };

    let tenantId: string | null = null;
    try {
      const check = await checkLoginCode(phone, code.data, "tenant_login");
      if (!check.valid) {
        return {
          ...codeState,
          error:
            check.reason === "wrong"
              ? `That code isn't right. You have ${check.attemptsLeft} ${check.attemptsLeft === 1 ? "try" : "tries"} left.`
              : "That code has expired. Tap Resend code for a new one.",
        };
      }
      const tenant = await findEligibleTenant(phone);
      if (tenant) {
        tenantId = tenant.id;
        await getDatabase().update(tenants).set({ lastLoginAt: new Date() }).where(eq(tenants.id, tenant.id));
      }
    } catch (error) {
      logError("Tenant login code check failed", error);
      return { ...codeState, error: "We couldn't check your code right now. Please try again." };
    }
    if (!tenantId) return { step: "phone", error: "We couldn't find that number. Check it, or contact your landlord." };

    const current = await listCurrentLeasesForTenant(tenantId);
    if (current.length > 1) {
      await setPendingLogin("tenant_choose_lease", tenantId);
      return { step: "lease", leases: current.map((lease) => ({ leaseId: lease.leaseId, label: `${lease.unitCode} · ${lease.buildingName}` })) };
    }
    await createSession({ role: "tenant", subject: tenantId, leaseId: current[0]?.leaseId });
    redirect("/tenants");
  }

  if (intent === "choose") {
    const tenantId = await readPendingLogin("tenant_choose_lease");
    if (!tenantId) return { step: "phone", error: "That sign-in attempt expired. Please start again." };
    const chosen = String(formData.get("leaseId") ?? "");
    const current = await listCurrentLeasesForTenant(tenantId);
    if (!current.some((lease) => lease.leaseId === chosen)) {
      return { ...previous, step: "lease", error: "Choose one of your units." };
    }
    await clearPendingLogin("tenant_choose_lease");
    await createSession({ role: "tenant", subject: tenantId, leaseId: chosen });
    redirect("/tenants");
  }

  return previous;
}
