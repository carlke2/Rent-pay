"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkLoginCode, issueLoginCode, LOGIN_CODE_LENGTH } from "@/authentication/login-codes";
import { getDecoyHash, verifyPassword } from "@/authentication/password";
import { clearPendingLogin, createSession, readPendingLogin, setPendingLogin } from "@/authentication/session";
import { getDatabase } from "@/database/client";
import { landlord } from "@/database/schema";
import { sendLandlordTwoFactorCode } from "@/services/notifications";
import { maskPhoneInternational } from "@/utilities/phone";
import { logError } from "@/utilities/log";

export type LandlordLoginState = {
  step: "password" | "code";
  error?: string;
  notice?: string;
  email?: string;
  maskedPhone?: string;
  next?: string;
  /** When the last code was sent (for the resend countdown). */
  codeSentAt?: number;
  /** "Keep me signed in": a lasting cookie when true, a browser-session cookie when false. */
  keepSignedIn?: boolean;
};

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

/** Only allow redirects back into the landlord app. */
function safeNext(next: unknown): string {
  const value = typeof next === "string" ? next : "";
  if (!value || !value.startsWith("/admin") || value.startsWith("//") || value.startsWith("/admin/login")) return "/admin";
  return value;
}

async function sendCode(landlordId: string, phone: string): Promise<string | null> {
  const issued = await issueLoginCode(phone, "landlord_two_factor");
  if (!issued.issued) return "Too many codes requested. Try again in 15 minutes.";
  await setPendingLogin("landlord_two_factor", landlordId);
  await sendLandlordTwoFactorCode(phone, issued.code);
  return null;
}

/**
 * Step 1: email + password. Step 2 (when two-factor is on): the 6-digit code sent to the landlord's phone.
 * The session (12 hours) is only created after both.
 */
export async function signInLandlord(previous: LandlordLoginState, formData: FormData): Promise<LandlordLoginState> {
  const intent = formData.get("intent");
  const next = safeNext(formData.get("next") ?? previous.next);
  const keepSignedIn = formData.get("keepSignedIn") === "on" || formData.get("keepSignedIn") === "true";

  if (intent === "restart") {
    await clearPendingLogin("landlord_two_factor");
    return { step: "password", next, keepSignedIn };
  }

  if (intent === "code" || intent === "resend") {
    const landlordId = await readPendingLogin("landlord_two_factor");
    if (!landlordId) return { step: "password", next, error: "That sign-in attempt expired. Please enter your password again." };
    const [account] = await getDatabase().select({ phone: landlord.phone }).from(landlord).where(eq(landlord.id, landlordId));
    if (!account?.phone) return { step: "password", next, error: "No phone number is set for this account." };
    const codeState = { step: "code" as const, next, keepSignedIn, maskedPhone: maskPhoneInternational(account.phone), codeSentAt: previous.codeSentAt };

    if (intent === "resend") {
      const problem = await sendCode(landlordId, account.phone);
      return problem ? { ...codeState, error: problem } : { ...codeState, notice: "A new code is on its way.", codeSentAt: Date.now() };
    }

    const code = String(formData.get("code") ?? "").trim();
    if (!new RegExp(`^\\d{${LOGIN_CODE_LENGTH}}$`).test(code)) return { ...codeState, error: `Enter the ${LOGIN_CODE_LENGTH}-digit code.` };
    const check = await checkLoginCode(account.phone, code, "landlord_two_factor");
    if (!check.valid) {
      return {
        ...codeState,
        error:
          check.reason === "wrong"
            ? `That code isn't right. You have ${check.attemptsLeft} ${check.attemptsLeft === 1 ? "try" : "tries"} left.`
            : "That code has expired or been used up. Send a new code.",
      };
    }
    await clearPendingLogin("landlord_two_factor");
    await createSession({ role: "landlord", subject: landlordId }, { keepSignedIn });
    redirect(next);
  }

  const parsed = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { step: "password", next, email, keepSignedIn, error: "Enter your email address and password." };

  let account: { id: string; phone: string | null; twoFactorEnabled: boolean } | null = null;
  try {
    const [row] = await getDatabase()
      .select({ id: landlord.id, passwordHash: landlord.passwordHash, phone: landlord.phone, twoFactorEnabled: landlord.twoFactorEnabled })
      .from(landlord)
      .where(eq(landlord.email, parsed.data.email))
      .limit(1);
    // Always run a hash check so response time doesn't reveal whether the email exists.
    const valid = await verifyPassword(parsed.data.password, row?.passwordHash ?? (await getDecoyHash()));
    if (row && valid) account = row;
  } catch (error) {
    logError("Landlord sign-in failed", error);
    return { step: "password", next, email, keepSignedIn, error: "We couldn't sign you in right now. Please try again." };
  }
  if (!account) return { step: "password", next, email, keepSignedIn, error: "Email or password is incorrect." };

  if (account.twoFactorEnabled) {
    if (!account.phone) return { step: "password", next, email, keepSignedIn, error: "Two-factor sign-in is on but this account has no phone number." };
    const problem = await sendCode(account.id, account.phone);
    if (problem) return { step: "password", next, email, keepSignedIn, error: problem };
    return { step: "code", next, keepSignedIn, maskedPhone: maskPhoneInternational(account.phone), codeSentAt: Date.now() };
  }

  await createSession({ role: "landlord", subject: account.id }, { keepSignedIn });
  redirect(next);
}
