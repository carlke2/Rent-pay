import type { Metadata } from "next";
import { LandlordLoginForm } from "@/components/admin/login-form";
import { SignInLayout } from "@/components/shared/sign-in/sign-in-layout";
import { getEnvironment } from "@/configuration/environment";

export const metadata: Metadata = { title: "Admin sign in" };

const ADMIN_MESSAGES = [
  { heading: "Every shilling, matched to the right unit.", text: "M-Pesa payments land on the right tenant automatically." },
  { heading: "Receipts in seconds.", text: "Tenants get a numbered receipt the moment they pay." },
  { heading: "Know who has paid, at a glance.", text: "Every unit in every building, live on one dashboard." },
];

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { next } = await searchParams;
  const environment = getEnvironment();
  return (
    <SignInLayout messages={ADMIN_MESSAGES}>
      <LandlordLoginForm next={typeof next === "string" ? next : undefined} appName={environment.APP_NAME} supportEmail={environment.SUPPORT_EMAIL} />
    </SignInLayout>
  );
}
