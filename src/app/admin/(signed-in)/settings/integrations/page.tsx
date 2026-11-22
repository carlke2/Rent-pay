import type { Metadata } from "next";
import { registerUrlsAction, simulatePaybillAction } from "@/app/admin/actions/settings";
import { ActionForm } from "@/components/shared/action-form";
import { DetailList, Panel } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { getEnvironment } from "@/configuration/environment";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  const environment = getEnvironment();
  const appUrl = environment.APP_URL.replace(/\/+$/, "");
  const credentials = Boolean(environment.MPESA_CONSUMER_KEY && environment.MPESA_CONSUMER_SECRET);
  const sandbox = environment.MPESA_ENV === "sandbox";
  const bank = [environment.BANK_NAME, environment.BANK_ACCOUNT_NAME, environment.BANK_ACCOUNT_NUMBER].some(Boolean);
  const smsReady = environment.SMS_PROVIDER === "console" || Boolean(environment.AT_API_KEY);

  return (
    <>
      <PageHeader title="Integrations" back={{ href: "/admin/settings", label: "Settings" }} description="These are set in the environment (.env or your hosting settings)." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="M-Pesa (Daraja)">
          <DetailList
            items={[
              ["Environment", <StatusBadge key="env" status={sandbox ? "partial" : "paid"} label={sandbox ? "Sandbox" : "Live"} />],
              ["Paybill (C2B)", environment.MPESA_SHORTCODE],
              ["STK shortcode", environment.MPESA_STK_SHORTCODE],
              ["Credentials", <StatusBadge key="cred" status={credentials ? "paid" : "overdue"} label={credentials ? "Set" : "Missing"} />],
              ["Callbacks", `${appUrl}/api/payments/…`],
            ]}
          />
          {!appUrl.startsWith("https://") ? (
            <p className="mt-3 rounded-md border border-status-overdue/25 bg-status-overdue-surface px-3 py-2 text-sm text-status-overdue">APP_URL is not HTTPS, so Daraja can&apos;t reach the callbacks. Use a public HTTPS address (e.g. a Cloudflare tunnel).</p>
          ) : null}
          <div className="mt-4 grid gap-4">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Tell Daraja where to send Paybill validation and confirmation callbacks.</p>
              <ActionForm action={registerUrlsAction} submitLabel="Register Paybill URLs" showResult inline confirm={{ title: "Register the Paybill URLs?", description: `Daraja will send Paybill payments for ${environment.MPESA_SHORTCODE} to ${appUrl}.` }} />
            </div>
            {sandbox ? (
              <ActionForm
                action={simulatePaybillAction}
                submitLabel="Simulate Paybill payment"
                submitVariant="outline"
                showResult
                fields={[
                  { name: "unitCode", label: "Unit code (account)", required: true, placeholder: "KIL-A04", span: "half" },
                  { name: "amount", label: "Amount (KES)", type: "number", required: true, defaultValue: 10, span: "half" },
                ]}
              />
            ) : null}
          </div>
        </Panel>

        <div className="grid gap-4">
          <Panel title="SMS">
            <DetailList
              items={[
                ["Provider", environment.SMS_PROVIDER === "console" ? "Console (development: printed in the server log)" : "Africa's Talking"],
                ["Status", <StatusBadge key="sms" status={smsReady ? "paid" : "overdue"} label={smsReady ? "Ready" : "API key missing"} />],
                ...(environment.SMS_PROVIDER === "africastalking"
                  ? ([
                      ["Username", environment.AT_USERNAME ?? "–"],
                      ["Sender ID", environment.AT_SENDER_ID ?? "Default"],
                    ] as [string, React.ReactNode][])
                  : []),
                ["Signature", `-${environment.APP_NAME}`],
                ["Queue", environment.QUEUE_PROVIDER === "qstash" ? "QStash" : "Inline (after each request)"],
                ["File storage", environment.STORAGE_PROVIDER === "s3" ? "S3-compatible" : "Local disk (development)"],
              ]}
            />
          </Panel>
          <Panel title="Bank details shown to tenants">
            {bank ? (
              <DetailList
                items={[
                  ["Bank", environment.BANK_NAME ?? "–"],
                  ["Branch", environment.BANK_BRANCH ?? "–"],
                  ["Account name", environment.BANK_ACCOUNT_NAME ?? "–"],
                  ["Account number", environment.BANK_ACCOUNT_NUMBER ?? "–"],
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Not set. Add BANK_NAME, BANK_BRANCH, BANK_ACCOUNT_NAME and BANK_ACCOUNT_NUMBER to show them in the tenant portal.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
