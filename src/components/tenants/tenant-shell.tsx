"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  FileClock,
  FileText,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  MoreVertical,
  ReceiptText,
  Smartphone,
  UploadCloud,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { signOutTenant } from "@/app/tenants/actions/session";
import { NavLink } from "@/components/shared/nav-link";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn } from "@/utilities/class-names";
import { ThemedLogo } from "../shared/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../shared/ui/dropdown-menu";

type Item = { href: string; label: string; icon: LucideIcon; also?: string[] };

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Home",
    items: [
      { href: "/tenants", label: "Overview", icon: LayoutGrid },
      { href: "/tenants/pay", label: "Pay rent", icon: Smartphone },
      { href: "/tenants/bills", label: "Bills", icon: FileText },
      { href: "/tenants/receipts", label: "Receipts", icon: ReceiptText },
      { href: "/tenants/statement", label: "Statement", icon: FileClock },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/tenants/report-payment", label: "Report a payment", icon: UploadCloud },
      { href: "/tenants/profile", label: "Profile", icon: UserRound },
    ],
  },
];

/** Phone bottom bar: the four everyday screens plus More. */
const BOTTOM: Item[] = [
  { href: "/tenants", label: "Home", icon: Home },
  { href: "/tenants/pay", label: "Pay", icon: Smartphone },
  { href: "/tenants/bills", label: "Bills", icon: FileText },
  { href: "/tenants/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/tenants/more", label: "More", icon: Menu, also: ["/tenants/statement", "/tenants/profile", "/tenants/report-payment"] },
];

const TITLES: [string, string][] = [
  ["/tenants/pay", "Pay rent"],
  ["/tenants/bills", "Bills"],
  ["/tenants/receipts", "Receipts"],
  ["/tenants/statement", "Statement"],
  ["/tenants/report-payment", "Report a payment"],
  ["/tenants/profile", "Profile"],
  ["/tenants/more", "More"],
];

const matches = (pathname: string, href: string) => (href === "/tenants" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
const isActive = (pathname: string, item: Item) => matches(pathname, item.href) || Boolean(item.also?.some((prefix) => matches(pathname, prefix)));

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "T"
  );
}

export type TenantShellProps = {
  appName: string;
  tenantName: string;
  unitCode: string | null;
  buildingName: string | null;
  canPay: boolean;
  children: React.ReactNode;
};

/** The tenant portal frame, matching the landlord app: black sidebar on desktop, top bar, bottom bar on phones. */
export function TenantShell({ appName, tenantName, unitCode, buildingName, canPay, children }: TenantShellProps) {
  const pathname = usePathname();
  const title = pathname === "/tenants" ? "Overview" : (TITLES.find(([prefix]) => matches(pathname, prefix))?.[1] ?? "Overview");

  return (
    <div className="theme-tenant min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r pt-[env(safe-area-inset-top)] border-sidebar-border bg-sidebar lg:flex print:hidden" aria-label="Sidebar">
        <div className="flex h-[72px] shrink-0 items-center px-4">
          <Link href="/tenants" className="flex min-w-0 items-center" aria-label={`${appName} home`}>
            <ThemedLogo kind="full" height={26} priority />
          </Link>
        </div>
        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => (
            <div key={group.label} className="mt-3 first:mt-1">
              <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{group.label}</p>
              <ul className="grid gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium no-underline transition-colors",
                          active
                            ? "bg-surface-raised text-heading shadow-[inset_0_0_0_1px_var(--nav-active-ring)] hover:text-heading"
                            : "text-text-secondary hover:bg-surface-raised/60 hover:text-heading",
                        )}
                      >
                        <item.icon className="size-[18px]" aria-hidden />
                        {item.label}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <ProfileMenu name={tenantName} detail={[unitCode, buildingName].filter(Boolean).join(" · ")} />
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-2 sm:gap-3 border-b border-sidebar-border bg-background pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:px-6 lg:h-[calc(72px+env(safe-area-inset-top))] lg:px-8 print:hidden">
          <Link href="/tenants" className="flex min-h-11 shrink-0 items-center lg:hidden" aria-label={`${appName} home`}>
            <ThemedLogo kind="full" height={26} priority />
          </Link>
          {/* Below md the full logo leaves no room for the title (the page heading says it); keep the space so nothing shifts. */}
          <p className="invisible min-w-0 flex-1 truncate font-display text-xl font-normal tracking-[-0.01em] text-heading md:visible lg:text-2xl">{title}</p>
          {unitCode ? (
            <span className="numbers hidden shrink-0 items-center rounded-full border border-border-strong px-3 py-1 text-sm font-medium text-heading sm:inline-flex">
              {unitCode}
              {buildingName ? <span className="ml-1.5 text-muted-foreground">· {buildingName}</span> : null}
            </span>
          ) : null}
          {canPay && !matches(pathname, "/tenants/pay") ? (
            <Link
              href="/tenants/pay"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline hover:bg-primary/90 hover:text-primary-foreground"
            >
              <Smartphone className="size-4" aria-hidden />
              Pay rent
            </Link>
          ) : null}
          <ThemeToggle />
          <div className="lg:hidden">
            <ProfileMenu name={tenantName} detail={[unitCode, buildingName].filter(Boolean).join(" · ")} compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-md px-[max(1rem,env(safe-area-inset-left))] pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-12 print:max-w-none print:p-0">{children}</main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] lg:hidden print:hidden">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {BOTTOM.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium no-underline", active ? "text-heading hover:text-heading" : "text-muted-foreground hover:text-heading")}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-surface-raised ring-1 ring-nav-active-ring")}>
                    <item.icon className="size-[18px]" aria-hidden />
                  </span>
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function ProfileMenu({ name, detail, compact = false }: { name: string; detail: string; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex items-center gap-3 rounded-xl text-left hover:bg-surface-raised", compact ? "min-h-11 min-w-11 justify-center p-1" : "w-full border bg-card p-2.5")}
          aria-label={`Account menu for ${name}`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised text-sm font-semibold text-heading ring-1 ring-border-strong">{initialsOf(name)}</span>
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <MoreVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "bottom" : "top"} align={compact ? "end" : "start"} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/tenants/profile" className="text-foreground no-underline">
            <UserRound className="size-4" aria-hidden /> Profile
            <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <form action={signOutTenant} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
