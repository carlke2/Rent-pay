"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navItemClass as itemClass, NavGroupLabel, UserMenu } from "@/components/shared/app-shell";
import { NavLink } from "@/components/shared/nav-link";
import {
  Building2,
  ChartColumn,
  ChevronDown,
  Droplets,
  FileText,
  LayoutGrid,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { signOutLandlord } from "@/app/admin/actions/session";
import type { AttentionItem } from "@/services/reports";
import { cn } from "@/utilities/class-names";
import { ThemedLogo } from "../shared/logo";
import { DropdownMenuItem } from "../shared/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../shared/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../shared/ui/tooltip";
import { AdminTopBar } from "./admin-top-bar";
import { SIDEBAR_COOKIE } from "./sidebar-preference";


type Badge = { count: number; tone: "white" | "grey" };
type Item = { href: string; label: string; icon: LucideIcon; badge?: Badge; children?: { href: string; label: string }[]; alsoActiveFor?: string[] };

export type AdminShellProps = {
  appName: string;
  landlordName: string;
  email: string;
  buildings: { id: string; name: string }[];
  paymentsBadge: number;
  readingsBadge: number;
  attention: { items: AttentionItem[]; total: number };
  initialCollapsed: boolean;
  currentPeriod: string;
  children: React.ReactNode;
};

const TITLES: [string, string][] = [
  ["/admin/buildings", "Buildings"],
  ["/admin/units", "Unit"],
  ["/admin/tenants", "Tenants"],
  ["/admin/move-in", "Move in"],
  ["/admin/move-out", "Move out"],
  ["/admin/payments", "Payments"],
  ["/admin/invoices", "Invoices"],
  ["/admin/meter-readings", "Meter readings"],
  ["/admin/reports", "Reports"],
  ["/admin/expenses", "Expenses"],
  ["/admin/messages", "Messages"],
  ["/admin/settings", "Settings"],
];

function pageTitle(pathname: string) {
  if (pathname === "/admin") return "Overview";
  return TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? "Overview";
}

function matches(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}


/** The landlord app frame: black sidebar (collapsible to an icon rail, a drawer under 1024px), top bar and content. */
export function AdminShell(props: AdminShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(props.initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [pathname]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/admin; max-age=31536000; samesite=lax`;
  }

  const groups: { label: string; items: Item[] }[] = [
    {
      label: "Home",
      items: [
        { href: "/admin", label: "Overview", icon: LayoutGrid },
        {
          href: "/admin/buildings",
          label: "Buildings",
          icon: Building2,
          alsoActiveFor: ["/admin/units"],
          children: [{ href: "/admin/buildings", label: "All buildings" }, ...props.buildings.map((building) => ({ href: `/admin/buildings/${building.id}`, label: building.name }))],
        },
        { href: "/admin/tenants", label: "Tenants", icon: Users, alsoActiveFor: ["/admin/move-in", "/admin/move-out"] },
        { href: "/admin/payments", label: "Payments", icon: Wallet, badge: { count: props.paymentsBadge, tone: "white" } },
        { href: "/admin/invoices", label: "Invoices", icon: FileText },
        { href: "/admin/meter-readings", label: "Meter readings", icon: Droplets, badge: { count: props.readingsBadge, tone: "grey" } },
      ],
    },
    {
      label: "Other",
      items: [
        { href: "/admin/reports", label: "Reports", icon: ChartColumn },
        { href: "/admin/expenses", label: "Expenses", icon: Receipt },
        { href: "/admin/messages", label: "Messages", icon: MessageSquare },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    },
  ];

  const sidebar = (rail: boolean, inDrawer: boolean) => (
    <SidebarContent
      appName={props.appName}
      groups={groups}
      pathname={pathname}
      rail={rail}
      landlordName={props.landlordName}
      email={props.email}
      onToggle={inDrawer ? undefined : toggleCollapsed}
    />
  );

  return (
    <TooltipProvider>
      <div className="theme-admin min-h-dvh bg-background text-foreground">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 hidden flex-col border-r pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex print:hidden",
            collapsed ? "w-[72px]" : "w-[248px]",
          )}
          aria-label="Sidebar"
        >
          {sidebar(collapsed, false)}
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-[280px] max-w-[85dvw] gap-0 border-sidebar-border bg-sidebar p-0 [&>button]:hidden">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
            {sidebar(false, true)}
          </SheetContent>
        </Sheet>

        <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]")}>
          <AdminTopBar
            title={pageTitle(pathname)}
            currentPeriod={props.currentPeriod}
            attention={props.attention}
            menuButton={
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="grid size-11 shrink-0 place-items-center rounded-lg border border-border-strong text-foreground hover:bg-surface-raised lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-5" aria-hidden />
              </button>
            }
            mobileLogo={
              <Link prefetch={false} href="/admin" className="grid size-11 shrink-0 place-items-center lg:hidden" aria-label={`${props.appName} home`}>
                <ThemedLogo kind="mark" height={28} priority />
              </Link>
            }
          />
          <main className="mx-auto w-full max-w-[1400px] px-[max(1rem,env(safe-area-inset-left))] pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 print:max-w-none print:p-0">{props.children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarContent({
  appName,
  groups,
  pathname,
  rail,
  landlordName,
  email,
  onToggle,
}: {
  appName: string;
  groups: { label: string; items: Item[] }[];
  pathname: string;
  rail: boolean;
  landlordName: string;
  email: string;
  onToggle?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex h-[72px] shrink-0 items-center gap-2", rail ? "justify-center px-2" : "justify-between px-4")}>
        {rail ? null : (
          <Link prefetch={false} href="/admin" className="flex min-w-0 items-center" aria-label={`${appName} home`}>
            <ThemedLogo kind="full" height={28} priority />
          </Link>
        )}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="group grid size-11 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-surface-raised hover:text-heading"
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!rail}
          >
            {rail ? (
              <>
                {/* Collapsed: the mark, swapping to the expand icon on hover or keyboard focus. */}
                <span className="group-hover:hidden group-focus-visible:hidden" aria-hidden>
                  <ThemedLogo kind="mark" height={28} priority />
                </span>
                <PanelLeftOpen className="hidden size-[18px] group-hover:block group-focus-visible:block" aria-hidden />
              </>
            ) : (
              <PanelLeftClose className="size-[18px]" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      <nav aria-label="Main" className={cn("min-h-0 flex-1 overflow-y-auto pb-4", rail ? "px-3" : "px-3")}>
        {groups.map((group) => (
          <div key={group.label} className="mt-3 first:mt-1">
            {rail ? <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden /> : <NavGroupLabel>{group.label}</NavGroupLabel>}
            <ul className="grid gap-0.5">
              {group.items.map((item) => (
                <NavItem key={item.href} item={item} pathname={pathname} rail={rail} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <ProfileCard name={landlordName} email={email} rail={rail} />
    </div>
  );
}


function CountBadge({ badge, rail }: { badge?: Badge; rail: boolean }) {
  if (!badge || badge.count <= 0) return null;
  const text = badge.count > 99 ? "99+" : String(badge.count);
  return (
    <span
      className={cn(
        "numbers grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold",
        badge.tone === "white" ? "bg-primary text-primary-foreground" : "bg-border-strong text-foreground",
        rail ? "absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]" : "ml-auto",
      )}
    >
      {text}
    </span>
  );
}

function NavItem({ item, pathname, rail }: { item: Item; pathname: string; rail: boolean }) {
  const active = matches(pathname, item.href) || Boolean(item.alsoActiveFor?.some((prefix) => matches(pathname, prefix)));
  const [open, setOpen] = useState(active);
  const label = item.badge && item.badge.count > 0 ? `${item.label}, ${item.badge.count} waiting` : item.label;

  if (rail) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink href={item.href} aria-current={active ? "page" : undefined} aria-label={label} className={itemClass(active, true)}>
              <span className="relative">
                <item.icon className="size-[18px]" aria-hidden />
                <CountBadge badge={item.badge} rail />
              </span>
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  if (item.children) {
    return (
      <li>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={cn(itemClass(active, false), "w-full")}>
          <item.icon className="size-[18px]" aria-hidden />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open ? (
          <ul className="mt-0.5 ml-[21px] grid gap-0.5 border-l border-dashed border-border-strong py-0.5 pl-3">
            {item.children.map((child) => {
              const childActive = pathname === child.href;
              return (
                <li key={child.href}>
                  <NavLink
                    href={child.href}
                    aria-current={childActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center truncate rounded-md px-2.5 text-[13px] no-underline",
                      childActive ? "bg-surface-raised text-heading shadow-[inset_0_0_0_1px_var(--nav-active-ring)] hover:text-heading" : "text-text-secondary hover:text-heading",
                    )}
                  >
                    {child.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li>
      <NavLink href={item.href} aria-current={active ? "page" : undefined} aria-label={label} className={itemClass(active, false)}>
        <item.icon className="size-[18px]" aria-hidden />
        <span className="flex-1">{item.label}</span>
        <CountBadge badge={item.badge} rail={false} />
      </NavLink>
    </li>
  );
}

function ProfileCard({ name, email, rail }: { name: string; email: string; rail: boolean }) {
  return (
    <div className={cn("shrink-0 border-t border-sidebar-border", rail ? "p-2" : "p-3")}>
      <UserMenu name={name} detail={email} variant={rail ? "rail" : "card"} signOut={signOutLandlord}>
        <DropdownMenuItem asChild>
          <Link prefetch={false} href="/admin/settings" className="text-foreground no-underline">
            <Settings className="size-4" aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
      </UserMenu>
    </div>
  );
}
