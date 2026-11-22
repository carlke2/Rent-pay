import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronRight, LogOut, ScrollText, UserRound } from "lucide-react";
import { signOutTenant } from "@/app/tenants/actions/session";
import { TenantHeading } from "@/components/tenants/tenant-heading";

export const metadata: Metadata = { title: "More" };

const LINKS = [
  { href: "/tenants/statement", label: "Statement", description: "Every charge and payment", icon: ScrollText },
  { href: "/tenants/report-payment", label: "Report a bank or cash payment", description: "Send your slip to the landlord", icon: Banknote },
  { href: "/tenants/profile", label: "Profile", description: "Phone numbers and WhatsApp", icon: UserRound },
];

export default function MorePage() {
  return (
    <>
      <TenantHeading title="More" />
      <ul className="grid gap-2">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-foreground no-underline hover:bg-surface-muted">
              <link.icon className="size-5 text-heading" aria-hidden />
              <span className="flex-1">
                <span className="block font-medium text-heading">{link.label}</span>
                <span className="block text-sm text-muted-foreground">{link.description}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
        <li>
          <form action={signOutTenant}>
            <button type="submit" className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left font-medium text-destructive hover:bg-surface-muted">
              <LogOut className="size-5" aria-hidden /> Log out
            </button>
          </form>
        </li>
      </ul>
    </>
  );
}
