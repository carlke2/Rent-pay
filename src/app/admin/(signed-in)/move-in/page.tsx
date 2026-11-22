import type { Metadata } from "next";
import { MoveInWizard } from "@/components/admin/move-in-wizard";
import { PageHeader } from "@/components/shared/page-header";
import { listVacantUnits } from "@/services/tenancy";
import { todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Move in" };

export default async function MoveInPage({ searchParams }: PageProps<"/admin/move-in">) {
  const { unitId } = await searchParams;
  const units = await listVacantUnits();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Move in a tenant" description="Unit, tenant, terms, opening reading, then review the first invoice." />
      <MoveInWizard units={units} initialUnitId={typeof unitId === "string" ? unitId : undefined} today={todayInNairobi()} />
    </div>
  );
}
