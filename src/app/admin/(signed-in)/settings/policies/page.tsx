import type { Metadata } from "next";
import { PolicyEditor } from "@/components/admin/policy-editor";
import { Panel } from "@/components/shared/detail-list";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { getPolicy, listPolicyHistory } from "@/services/policies";
import { listBuildings } from "@/services/tenancy";
import { formatDate, formatNairobiDateTime, todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Rent policies" };

export default async function PoliciesPage({ searchParams }: PageProps<"/admin/settings/policies">) {
  const { scope } = await searchParams;
  const [buildings, history] = await Promise.all([listBuildings(), listPolicyHistory()]);
  const building = buildings.find((item) => item.id === scope);
  const today = todayInNairobi();
  const resolved = await getPolicy(building?.id ?? null, today);
  const scopeLabel = building ? building.name : "all buildings";
  const usingAccount = building && resolved.source !== "building";

  return (
    <>
      <PageHeader
        title="Rent policies"
        back={{ href: "/admin/settings", label: "Settings" }}
        description={building ? `Override for ${building.name}. Buildings without an override use the account policy.` : "The account policy applies to every building without its own override."}
      />
      <FilterBar
        fields={[
          {
            name: "scope",
            label: "Policy for",
            type: "select",
            value: building?.id ?? "account",
            options: [{ value: "account", label: "All buildings (account policy)" }, ...buildings.map((item) => ({ value: item.id, label: `${item.name} (override)` }))],
          },
        ]}
      />
      {usingAccount ? (
        <p className="mb-4 rounded-lg border bg-brand-surface px-3 py-2 text-sm text-brand">{building.name} uses the account policy today. Saving here creates an override for this building.</p>
      ) : null}
      <PolicyEditor key={building?.id ?? "account"} scope={building?.id ?? "account"} scopeLabel={scopeLabel} initial={resolved.settings} today={today} />

      <Panel title="Change history" className="mt-6">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No policies saved yet; defaults apply.</p>
        ) : (
          <ResponsiveTable
            rows={history}
            rowKey={(row) => row.id}
            columns={[
              { key: "scope", header: "Applies to", primary: true, cell: (row) => row.buildingName ?? "All buildings" },
              { key: "from", header: "Effective", cell: (row) => formatDate(row.effectiveFrom) },
              { key: "summary", header: "Summary", cell: (row) => `Due day ${row.settings.dueDay}, grace ${row.settings.graceDays}d, ${row.settings.penalty.type === "none" ? "no penalty" : row.settings.penalty.type === "flat" ? `penalty KES ${row.settings.penalty.amount}` : `penalty ${row.settings.penalty.percent}%`}, water KES ${row.settings.water.ratePerUnit}/unit, ${row.settings.fixedCharges.map((charge) => `${charge.name} ${charge.amount}`).join(", ") || "no fixed charges"}` },
              { key: "by", header: "Saved by", cell: (row) => (row.createdBy.startsWith("landlord:") ? "Landlord" : row.createdBy) },
              { key: "at", header: "Saved", cell: (row) => formatNairobiDateTime(row.createdAt) },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
