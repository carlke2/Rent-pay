import type { Metadata } from "next";
import { ImportScreen } from "@/components/admin/import-screen";
import { PageHeader } from "@/components/shared/page-header";
import { closedBefore } from "@/services/closed-periods";
import { defaultCutOver } from "@/services/imports";
import { formatDate, todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const closed = await closedBefore();
  return (
    <>
      <PageHeader
        title="Import opening balances"
        back={{ href: "/admin/settings", label: "Settings" }}
        description="Bring in your buildings, units, tenants and what each tenant owed before you started, plus their past payments and charges for the record."
      />
      {closed ? (
        <p className="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          An earlier import closed every period before {formatDate(closed)}.
        </p>
      ) : null}
      <ImportScreen defaultCutOver={defaultCutOver(todayInNairobi())} />
    </>
  );
}
