import { statusSurfaceClass } from "@/components/shared/status-badge";
import { cn } from "@/utilities/class-names";
import { formatAmount } from "@/utilities/money";

/**
 * Dashboard building blocks shared by the landlord overview and the tenant overview, so both use the same
 * cards, numbers, pills, section headers and tables.
 */

export const dashboardCard = "rounded-[14px] border bg-card";

export const dashboardTable = {
  table: "w-full text-sm",
  headRow: "border-y bg-surface-sunken text-left text-xs font-medium text-muted-foreground",
  th: "px-3 py-2.5 font-medium first:pl-5 last:pr-5",
  body: "divide-y",
  row: "hover:bg-surface-raised/50",
  td: "px-3 py-3 first:pl-5 last:pr-5",
};

/** A KES amount at stat size: "KES" small and dimmed, the number large. */
export function Amount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("numbers text-[28px] leading-none font-semibold tracking-[-0.02em] text-heading", className)}>
      <span className="mr-1 text-base font-medium opacity-60">KES</span>
      {formatAmount(value)}
    </span>
  );
}

/** Stat-size placeholder when there is no value yet. */
export function NoAmount() {
  return <span className="numbers text-[28px] leading-none font-semibold tracking-[-0.02em] text-heading">–</span>;
}

/** A small status-coloured pill (paid, partial, overdue, …) on a stat card. */
export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("numbers rounded-full border px-2.5 py-0.5 text-xs font-semibold", statusSurfaceClass(tone))}>{children}</span>;
}

/** The bordered stat card: label, value (+ optional pill), note. */
export function StatTile({ label, value, pill, note, className }: { label: string; value: React.ReactNode; pill?: React.ReactNode; note: React.ReactNode; className?: string }) {
  return (
    <div className={cn(dashboardCard, "p-5", className)}>
      <p className="text-sm font-medium text-text-secondary">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {value}
        {pill}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** The highlighted (inverted) stat card, e.g. "Collected" for the landlord and "Amount due" for a tenant. */
export function HighlightTile({ label, badge, value, note, children, className }: { label: string; badge?: React.ReactNode; value: React.ReactNode; note: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col rounded-[14px] bg-primary p-5 text-primary-foreground", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-primary-foreground/60">{label}</p>
        {badge}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">{value}</div>
      <p className="mt-2 text-xs text-primary-foreground/60">{note}</p>
      {children}
    </div>
  );
}

/** The white pill on the highlighted card. */
export function HighlightBadge({ children }: { children: React.ReactNode }) {
  return <span className="numbers rounded-full bg-primary-foreground px-2.5 py-0.5 text-xs font-semibold text-primary">{children}</span>;
}

/** Card heading with an optional count bubble and an action on the right. */
export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-heading">
        {title}
        {count ? <span className="numbers grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

/** Page title row: heading and description on the left, actions on the right. */
export function DashboardHeader({ title, description, actions, display = false }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; display?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className={cn("text-2xl text-heading sm:text-[28px]", display ? "font-display font-normal tracking-[-0.01em]" : "font-semibold")}>{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
