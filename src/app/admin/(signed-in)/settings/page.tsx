import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileUp, MessageSquareText, Plug, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { href: "/admin/settings/policies", title: "Rent policies", description: "Due day, grace, penalties, water, fixed charges, reminders", icon: SlidersHorizontal },
  { href: "/admin/settings/integrations", title: "Integrations", description: "M-Pesa, SMS and the bank details tenants see", icon: Plug },
  { href: "/admin/settings/templates", title: "SMS templates", description: "The wording of every message", icon: MessageSquareText },
  { href: "/admin/settings/import", title: "Import", description: "Opening balances, tenants and payment history from a spreadsheet", icon: FileUp },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <ul className="grid gap-3">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className="flex items-center gap-4 rounded-xl border bg-card p-4 text-foreground no-underline hover:border-brand">
              <section.icon className="size-5 text-brand" aria-hidden />
              <span className="flex-1">
                <span className="block font-medium">{section.title}</span>
                <span className="block text-sm text-muted-foreground">{section.description}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
