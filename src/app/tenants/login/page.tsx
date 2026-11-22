import type { Metadata } from "next";
import { TenantLoginForm } from "@/components/tenants/login-form";
import { SignInLayout } from "@/components/shared/sign-in/sign-in-layout";
import { getEnvironment } from "@/configuration/environment";

export const metadata: Metadata = { title: "Tenant sign in" };

const TENANT_MESSAGES = [
  { heading: "Pay rent in one tap.", text: "Tap Pay now, enter your M-Pesa PIN, and you're done." },
  { heading: "Your receipt, instantly.", text: "Every payment gets a numbered receipt by SMS." },
  { heading: "Your balance, any time.", text: "Bills, receipts and statements, right on your phone." },
];

export default async function TenantLoginPage({ searchParams }: PageProps<"/tenants/login">) {
  const { link } = await searchParams;
  const environment = getEnvironment();
  return (
    <SignInLayout messages={TENANT_MESSAGES}>
      <TenantLoginForm
        paybill={environment.MPESA_SHORTCODE}
        appName={environment.APP_NAME}
        supportEmail={environment.SUPPORT_EMAIL}
        expiredLink={link === "expired"}
        testSignIn={environment.MPESA_ENV === "sandbox"}
      />
    </SignInLayout>
  );
}
