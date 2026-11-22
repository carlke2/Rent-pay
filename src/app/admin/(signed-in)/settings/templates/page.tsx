import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getEnvironment } from "@/configuration/environment";
import { MESSAGE_TEMPLATES } from "@/services/notifications";

export const metadata: Metadata = { title: "SMS templates" };

export default function TemplatesPage() {
  const appName = getEnvironment().APP_NAME;
  return (
    <>
      <PageHeader
        title="SMS templates"
        back={{ href: "/admin/settings", label: "Settings" }}
        description={`The current wording (read-only for now). Parts that are zero are left out, and every message ends with "-${appName}". No messages go out between 21:00 and 07:00 except receipts and login codes.`}
      />
      <ul className="grid gap-3">
        {MESSAGE_TEMPLATES.map((item) => (
          <li key={item.template} className="rounded-xl border bg-card p-4">
            <p className="font-medium">{item.name}</p>
            <p className="mt-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-words">{item.wording}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
