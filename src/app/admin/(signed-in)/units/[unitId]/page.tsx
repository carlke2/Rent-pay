import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateUnitAction } from "@/app/admin/actions/property";
import { changeRentAction, depositRefundAction, giveNoticeAction } from "@/app/admin/actions/tenancy";
import { ActionForm } from "@/components/shared/action-form";
import { DetailList, Panel } from "@/components/shared/detail-list";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import { getUnitDetail } from "@/services/tenancy";
import { formatDate, formatPeriod, todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Unit" };

export default async function UnitPage({ params }: PageProps<"/admin/units/[unitId]">) {
  const { unitId } = await params;
  const detail = await getUnitDetail(unitId);
  if (!detail) notFound();
  const { unit, current } = detail;
  const today = todayInNairobi();

  return (
    <>
      <PageHeader
        title={`Unit ${unit.code}`}
        description={`${unit.type} · ${detail.buildingName}`}
        back={{ href: `/admin/buildings/${unit.buildingId}`, label: detail.buildingName }}
        actions={
          <>
            {!current && unit.status === "vacant" ? (
              <Button asChild size="sm">
                <Link href={`/admin/move-in?unitId=${unit.id}`} className="no-underline">Move in</Link>
              </Button>
            ) : null}
            {current ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/admin/move-out?leaseId=${current.leaseId}`} className="text-foreground no-underline">Move out</Link>
              </Button>
            ) : null}
            <ActionForm
              action={updateUnitAction}
              submitLabel="Save unit"
              dialog={{ trigger: "Edit unit", title: `Edit ${unit.code}` }}
              fields={[
                { name: "unitId", label: "", type: "hidden", defaultValue: unit.id },
                { name: "code", label: "Unit code", required: true, defaultValue: unit.code, span: "half" },
                { name: "type", label: "Type", required: true, defaultValue: unit.type, span: "half" },
                { name: "rentAmount", label: "Rent (KES)", type: "number", required: true, defaultValue: unit.rentAmount, span: "half", hint: "For new tenants; use Change rent for the current lease" },
                { name: "depositAmount", label: "Deposit (KES)", type: "number", defaultValue: unit.depositAmount, span: "half" },
                { name: "floor", label: "Floor", type: "number", defaultValue: unit.floor, span: "half" },
                { name: "meterNumber", label: "Water meter number", defaultValue: unit.meterNumber, span: "half" },
                ...(current
                  ? []
                  : [
                      {
                        name: "status",
                        label: "Status",
                        type: "select" as const,
                        defaultValue: unit.status === "occupied" ? "vacant" : unit.status,
                        options: [
                          { value: "vacant", label: "Vacant" },
                          { value: "reserved", label: "Reserved" },
                          { value: "under_repair", label: "Under repair" },
                        ],
                      },
                    ]),
              ]}
            />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Unit details">
          <DetailList
            items={[
              ["Status", <StatusBadge key="status" status={unit.status} />],
              ["Rent", <Money key="rent" amount={unit.rentAmount} />],
              ["Deposit", <Money key="deposit" amount={unit.depositAmount} />],
              ["Floor", unit.floor ?? "–"],
              ["Water meter", unit.meterNumber ?? "None"],
              ["Paybill account", unit.code],
            ]}
          />
        </Panel>

        <Panel
          title="Current lease"
          actions={
            current ? (
              <>
                {current.status === "active" ? (
                  <ActionForm
                    action={giveNoticeAction}
                    submitLabel="Record notice"
                    dialog={{ trigger: "Give notice", title: "Record notice", description: "The last month's invoice will be prorated to the move-out date." }}
                    fields={[
                      { name: "leaseId", label: "", type: "hidden", defaultValue: current.leaseId },
                      { name: "noticeDate", label: "Notice given on", type: "date", required: true, defaultValue: today, span: "half" },
                      { name: "moveOutDate", label: "Moving out on", type: "date", required: true, span: "half" },
                      { name: "reason", label: "Note", type: "textarea" },
                    ]}
                  />
                ) : null}
                <ActionForm
                  action={changeRentAction}
                  submitLabel="Save rent change"
                  dialog={{ trigger: "Change rent", title: "Change rent", description: "Applies to invoices for periods starting on or after the date." }}
                  confirm={{ title: "Change the rent?", description: "Invoices already issued stay as they are. New invoices use the new rent from the start date." }}
                  fields={[
                    { name: "leaseId", label: "", type: "hidden", defaultValue: current.leaseId },
                    { name: "amount", label: "New rent (KES)", type: "number", required: true, defaultValue: current.rentNow, span: "half" },
                    { name: "effectiveFrom", label: "From", type: "date", required: true, span: "half" },
                    { name: "reason", label: "Reason", type: "textarea" },
                  ]}
                />
              </>
            ) : null
          }
        >
          {current ? (
            <DetailList
              items={[
                ["Tenant", <Link key="tenant" href={`/admin/tenants/${current.tenantId}?lease=${current.leaseId}`}>{current.tenantName}</Link>],
                ["Phone", `0${current.tenantPhone.slice(3)}`],
                ["Status", <StatusBadge key="status" status={current.status} />],
                ["Since", formatDate(current.startDate)],
                ["Rent", <Money key="rent" amount={current.rentNow} />],
                ["Balance", <Money key="balance" amount={current.balance} balance />],
                ["Deposit held", <Money key="deposit" amount={current.depositHeld} />],
                ...(current.moveOutDate ? ([["Moving out", formatDate(current.moveOutDate)]] as [string, React.ReactNode][]) : []),
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No current tenant.</p>
          )}
        </Panel>
      </div>

      <Panel title="Meter history" className="mt-4">
        {detail.readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No readings yet.</p>
        ) : (
          <ResponsiveTable
            rows={detail.readings}
            rowKey={(row) => row.id}
            columns={[
              { key: "period", header: "Period", primary: true, cell: (row) => formatPeriod(row.period) },
              { key: "kind", header: "Kind", cell: (row) => (row.kind === "regular" ? "Monthly" : row.kind === "opening" ? "Move-in" : "Move-out") },
              { key: "readOn", header: "Read on", cell: (row) => formatDate(row.readOn) },
              { key: "previous", header: "Previous", align: "right", cell: (row) => row.previousReading },
              { key: "current", header: "Reading", align: "right", cell: (row) => row.currentReading },
              { key: "use", header: "Used", align: "right", cell: (row) => row.consumption },
              { key: "state", header: "Status", cell: (row) => <StatusBadge status={row.confirmed ? "confirmed" : "flagged"} /> },
            ]}
          />
        )}
      </Panel>

      <Panel title="Past tenants" className="mt-4">
        {detail.pastLeases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No past tenants.</p>
        ) : (
          <ResponsiveTable
            rows={detail.pastLeases}
            rowKey={(row) => row.leaseId}
            columns={[
              { key: "tenant", header: "Tenant", primary: true, cell: (row) => <Link href={`/admin/tenants/${row.tenantId}?lease=${row.leaseId}`}>{row.tenantName}</Link> },
              { key: "from", header: "From", cell: (row) => formatDate(row.startDate) },
              { key: "to", header: "To", cell: (row) => (row.endDate ? formatDate(row.endDate) : "–") },
              { key: "refund", header: "Deposit to refund", align: "right", cell: (row) => <Money amount={Math.max(0, row.depositRefundDue - row.depositRefundedAmount)} /> },
              {
                key: "actions",
                header: "",
                hideOnCard: false,
                cell: (row) =>
                  row.depositRefundDue - row.depositRefundedAmount > 0 ? (
                    <ActionForm
                      action={depositRefundAction}
                      submitLabel="Record refund"
                      dialog={{ trigger: "Refund deposit", title: `Refund deposit to ${row.tenantName}` }}
                      confirm={{ title: "Record this refund?", description: "This records money paid back to the tenant from their deposit." }}
                      fields={[
                        { name: "leaseId", label: "", type: "hidden", defaultValue: row.leaseId },
                        { name: "amount", label: "Amount (KES)", type: "number", required: true, defaultValue: row.depositRefundDue - row.depositRefundedAmount, span: "half" },
                        { name: "refundedOn", label: "Paid on", type: "date", required: true, defaultValue: today, span: "half" },
                        { name: "method", label: "Method", type: "select", required: true, defaultValue: "mpesa", span: "half", options: [{ value: "mpesa", label: "M-Pesa" }, { value: "bank", label: "Bank" }, { value: "cash", label: "Cash" }] },
                        { name: "reference", label: "Reference", span: "half" },
                      ]}
                    />
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
