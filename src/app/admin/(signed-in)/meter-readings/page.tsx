import type { Metadata } from "next";
import { Droplets } from "lucide-react";
import { MeterReadingSheet } from "@/components/admin/meter-reading-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { getMeterReadingSheet } from "@/services/billing";
import { listBuildings } from "@/services/tenancy";
import { currentPeriod, formatPeriod, isBillingPeriod } from "@/utilities/dates";

export const metadata: Metadata = { title: "Meter readings" };

export default async function MeterReadingsPage({ searchParams }: PageProps<"/admin/meter-readings">) {
  const query = await searchParams;
  const buildings = await listBuildings();
  const buildingId = typeof query.building === "string" && buildings.some((b) => b.id === query.building) ? query.building : buildings[0]?.id;
  const period = typeof query.period === "string" && isBillingPeriod(query.period) ? query.period : currentPeriod();
  const sheet = buildingId ? await getMeterReadingSheet({ buildingId, period }) : null;
  const metered = sheet?.rows.filter((row) => row.meterNumber).length ?? 0;

  return (
    <>
      <PageHeader title="Meter readings" description={`Readings for ${formatPeriod(period)} are billed on next month's invoice.`} />
      <FilterBar
        fields={[
          { name: "building", label: "Building", type: "select", value: buildingId, options: buildings.map((building) => ({ value: building.id, label: building.name })) },
          { name: "period", label: "Month", type: "month", value: period },
        ]}
      />
      {!sheet ? (
        <EmptyState icon={Droplets} title="No buildings yet" />
      ) : metered === 0 ? (
        <EmptyState icon={Droplets} title="No water meters in this building" description="Add a meter number to a unit to record its readings." />
      ) : (
        <MeterReadingSheet key={`${buildingId}-${period}`} period={period} rows={sheet.rows} ratePerUnit={sheet.ratePerUnit} standingCharge={sheet.standingCharge} highlightUnitId={typeof query.unit === "string" ? query.unit : undefined} />
      )}
    </>
  );
}
