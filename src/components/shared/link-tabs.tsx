"use client";

import { NavLink } from "@/components/shared/nav-link";
import { cn } from "@/utilities/class-names";

/** Tabs that are links, so the selected tab lives in the URL and works with server rendering. */
export function LinkTabs({ tabs, active, label }: { tabs: { value: string; label: string; href: string; count?: number }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 overflow-x-auto rounded-lg border bg-muted/60 p-1 print:hidden">
      {tabs.map((tab) => (
        <NavLink
          key={tab.value}
          href={tab.href}
          aria-current={tab.value === active ? "page" : undefined}
          className={cn(
            "flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-center text-sm font-medium whitespace-nowrap text-muted-foreground no-underline hover:text-foreground",
            tab.value === active && "bg-card text-foreground shadow-sm",
          )}
        >
          {tab.label}
          {tab.count ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{tab.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
