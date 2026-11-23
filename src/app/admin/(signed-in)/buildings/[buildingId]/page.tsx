import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Home } from "lucide-react";
import { createUnitAction, updateBuildingAction } from "@/app/admin/actions/property";
import { UnitGrid } from "@/components/admin/unit-grid";
import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { statusLabel } from "@/components/shared/status-badge";
import { unitStatusBoard } from "@/services/reports";
import { getBuilding } from "@/services/tenancy";
import { cn } from "@/utilities/class-names";

export const metadata: Metadata = { title: "Building" };

const FILTERS = ["all", "paid", "partial", "unpaid", "overdue", "vacant", "notice"] as const;

export default async function BuildingPage({ params, searchParams }: PageProps<"/admin/buildings/[buildingId]">) {
  const { buildingId } = await params;
  const { status } = await searchParams;
  const building = await getBuilding(buildingId);
  if (!building) notFound();
  const [board] = await unitStatusBoard({ buildingId });
  const units = board?.units ?? [];
  const filter = typeof status === "string" && (FILTERS as readonly string[]).includes(status) ? status : "all";
  const shown = units.filter((unit) =>
    filter === "all" ? true : filter === "notice" ? unit.leaseStatus === "notice" : unit.paymentStatus === filter,
  );

  const addUnit = (
    <ActionForm
      action={createUnitAction}
      submitLabel="Add unit"
      dialog={{ trigger: "Add unit", title: `Add a unit to ${building.name}`, triggerVariant: "default" }}
      fields={[
        { name: "buildingId", label: "", type: "hidden", defaultValue: building.id },
        { name: "code", label: "Unit code", required: true, placeholder: `${building.codePrefix}-A01`, hint: "Tenants use this as the Paybill account number (max 12 characters)", span: "half" },
        { name: "type", label: "Type", required: true, placeholder: "One bedroom", span: "half" },
        { name: "rentAmount", label: "Rent (KES)", type: "number", required: true, span: "half" },
        { name: "depositAmount", label: "Deposit (KES)", type: "number", span: "half" },
        { name: "floor", label: "Floor", type: "number", span: "half" },
        { name: "meterNumber", label: "Water meter number", span: "half" },
      ]}
    />
  );

  return (
    <>
      <PageHeader
        title={building.name}
        description={building.location ?? undefined}
        back={{ href: "/admin/buildings", label: "Buildings" }}
        actions={
          <>
            <ActionForm
              action={updateBuildingAction}
              submitLabel="Save"
              dialog={{ trigger: "Edit building", title: "Edit building" }}
              fields={[
                { name: "buildingId", label: "", type: "hidden", defaultValue: building.id },
                { name: "name", label: "Name", required: true, defaultValue: building.name },
                { name: "location", label: "Location", defaultValue: building.location },
                { name: "codePrefix", label: "Unit code prefix", required: true, defaultValue: building.codePrefix },
              ]}
            />
            {addUnit}
          </>
        }
      />

      {board ? (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Units" value={board.totals.units} />
          <StatCard label="Occupied" value={board.totals.occupied} />
          <StatCard label="Collected" value={<Money amount={board.totals.collected} />} hint={<>of <Money amount={board.totals.expected} /></>} />
          <StatCard label="Arrears" value={<Money amount={board.totals.arrears} />} />
        </section>
      ) : null}

      <nav aria-label="Filter units" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((option) => (
          <Link prefetch={false}
            key={option}
            href={option === "all" ? `/admin/buildings/${building.id}` : `/admin/buildings/${building.id}?status=${option}`}
            aria-current={filter === option ? "page" : undefined}
            className={cn(
              "inline-flex min-h-8 items-center rounded-full border bg-card px-3.5 text-sm pointer-coarse:min-h-11 whitespace-nowrap text-foreground no-underline",
              filter === option && "border-brand bg-brand-surface text-brand",
            )}
          >
            {statusLabel(option)} ({option === "all" ? units.length : units.filter((unit) => (option === "notice" ? unit.leaseStatus === "notice" : unit.paymentStatus === option)).length})
          </Link>
        ))}
      </nav>

      {units.length === 0 ? (
        <EmptyState icon={Home} title="No units yet" description="Add the units in this building." action={addUnit} />
      ) : shown.length === 0 ? (
        <EmptyState title="No units with this status" />
      ) : (
        <UnitGrid units={shown} />
      )}
    </>
  );
}
