import Link from "next/link";
import { Money } from "@/components/shared/money";
import { StatusBadge, statusSurfaceClass } from "@/components/shared/status-badge";
import type { BoardUnit } from "@/services/reports";
import { cn } from "@/utilities/class-names";

/** Unit tiles: code, tenant, balance and status (with "Notice" when the tenant has given notice). */
export function UnitGrid({ units }: { units: BoardUnit[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {units.map((unit) => (
        <li key={unit.unitId}>
          <Link
            href={`/admin/units/${unit.unitId}`}
            className={cn(
              "flex h-full flex-col gap-2 rounded-xl border bg-card p-3 text-foreground no-underline transition hover:border-brand hover:shadow-sm",
              unit.paymentStatus === "vacant" && "border-dashed bg-status-vacant-surface",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{unit.unitCode}</span>
              {unit.leaseStatus === "notice" ? <StatusBadge status="notice" /> : null}
            </div>
            <span className="truncate text-sm text-muted-foreground">{unit.tenantName ?? (unit.unitStatus === "vacant" ? "No tenant" : unit.unitStatus.replace("_", " "))}</span>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-1">
              <StatusBadge status={unit.paymentStatus} />
              {unit.leaseId ? <Money amount={unit.balance} balance className="text-sm font-medium" /> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Small coloured squares for the dashboard; each is labelled and links to the unit. */
export function MiniUnitGrid({ units }: { units: BoardUnit[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {units.map((unit) => (
        <li key={unit.unitId}>
          <Link
            href={`/admin/units/${unit.unitId}`}
            title={`${unit.unitCode}: ${unit.paymentStatus}${unit.tenantName ? `, ${unit.tenantName}` : ""}`}
            className={cn("inline-flex h-11 min-w-14 items-center justify-center rounded-md border px-2 text-xs font-medium no-underline", statusSurfaceClass(unit.paymentStatus))}
          >
            {unit.unitCode}
            <span className="sr-only">, {unit.paymentStatus}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {["paid", "partial", "unpaid", "overdue", "vacant"].map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  );
}
