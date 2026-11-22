import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { createBuildingAction } from "@/app/admin/actions/property";
import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { listBuildings } from "@/services/tenancy";

export const metadata: Metadata = { title: "Buildings" };

const buildingFields = [
  { name: "name", label: "Name", required: true, placeholder: "Kilimani Heights" },
  { name: "location", label: "Location", placeholder: "Kilimani, Nairobi" },
  { name: "codePrefix", label: "Unit code prefix", required: true, placeholder: "KIL", hint: "Used at the start of unit codes, e.g. KIL-A04" },
];

export default async function BuildingsPage() {
  const buildings = await listBuildings();
  const addButton = (
    <ActionForm
      action={createBuildingAction}
      fields={buildingFields}
      submitLabel="Add building"
      dialog={{ trigger: "Add building", title: "Add a building", triggerVariant: "default" }}
    />
  );
  return (
    <>
      <PageHeader title="Buildings" description={`${buildings.length} buildings`} actions={addButton} />
      {buildings.length === 0 ? (
        <EmptyState icon={Building2} title="No buildings yet" description="Add your first building, then its units." action={addButton} />
      ) : (
        <ResponsiveTable
          rows={buildings}
          rowKey={(row) => row.id}
          columns={[
            { key: "name", header: "Building", primary: true, cell: (row) => <Link href={`/admin/buildings/${row.id}`} className="font-medium">{row.name}</Link> },
            { key: "location", header: "Location", cell: (row) => row.location ?? "–" },
            { key: "prefix", header: "Prefix", cell: (row) => row.codePrefix },
            { key: "units", header: "Units", align: "right", cell: (row) => row.units },
            { key: "occupied", header: "Occupied", align: "right", cell: (row) => `${row.occupied} of ${row.units}` },
          ]}
        />
      )}
    </>
  );
}
