import type { Metadata } from "next";
import Link from "next/link";
import { Download, Wallet } from "lucide-react";
import { assignPaymentAction, confirmClaimAction, reconcileAction, rejectClaimAction, reversePaymentAction } from "@/app/admin/actions/payments";
import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LinkTabs } from "@/components/shared/link-tabs";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { PaidByOtherNote, PaidByOtherTag } from "@/components/shared/paid-by-other";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import {
  getClaimSlipUrl,
  listAssignableLeases,
  listPaymentClaims,
  listPaymentRequests,
  listPayments,
  type PaymentChannel,
} from "@/services/payments";
import { listBuildings } from "@/services/tenancy";
import { addDays, formatDate, formatNairobiDateTime, isIsoDate, todayInNairobi } from "@/utilities/dates";

export const metadata: Metadata = { title: "Payments" };

const TABS = ["all", "unmatched", "claims", "requests"] as const;
const CHANNELS: PaymentChannel[] = ["stk", "paybill", "bank", "cash"];

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const query = await searchParams;
  const tab = TABS.find((value) => value === query.tab) ?? "all";
  const today = todayInNairobi();
  const from = typeof query.from === "string" && isIsoDate(query.from) ? query.from : undefined;
  const to = typeof query.to === "string" && isIsoDate(query.to) ? query.to : undefined;
  const buildingId = typeof query.building === "string" && query.building ? query.building : undefined;
  const channel = CHANNELS.find((value) => value === query.channel);
  // ?payment={id} (from the overview's Assign buttons and search) opens that payment's Assign dialog.
  const openPaymentId = typeof query.payment === "string" ? query.payment : undefined;

  const [unmatchedCount, waitingClaims, buildings] = await Promise.all([
    listPayments({ status: "unmatched", limit: 500 }).then((rows) => rows.length),
    listPaymentClaims({ status: "waiting" }),
    listBuildings(),
  ]);

  const tabs = TABS.map((value) => ({
    value,
    label: value === "all" ? "All" : value === "unmatched" ? "Unmatched" : value === "claims" ? "Claims" : "Requests",
    href: value === "all" ? "/admin/payments" : `/admin/payments?tab=${value}`,
    count: value === "unmatched" ? unmatchedCount : value === "claims" ? waitingClaims.length : undefined,
  }));
  const exportFrom = from ?? addDays(today, -30);
  const exportTo = to ?? today;

  return (
    <>
      <PageHeader
        title="Payments"
        actions={
          <>
            <ActionForm
              action={reconcileAction}
              submitLabel="Import"
              showResult
              dialog={{ trigger: "Upload M-Pesa statement", title: "Upload M-Pesa statement", description: "Download the statement CSV from the M-Pesa business portal. Receipts not yet recorded are imported and matched by account number." }}
              fields={[{ name: "file", label: "Statement (CSV)", type: "file", accept: ".csv,text/csv", required: true }]}
            />
            <Button asChild variant="outline" size="sm">
              <a href={`/admin/reports/export?report=payment-log&from=${exportFrom}&to=${exportTo}`} className="text-foreground no-underline">
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />
      <LinkTabs label="Payment views" tabs={tabs} active={tab} />
      {tab === "all" || tab === "unmatched" ? (
        <PaymentList status={tab} from={from} to={to} buildingId={buildingId} channel={channel} buildings={buildings} openPaymentId={openPaymentId} />
      ) : tab === "claims" ? (
        <ClaimList />
      ) : (
        <RequestList />
      )}
    </>
  );
}

async function PaymentList(props: {
  status: "all" | "unmatched";
  from?: string;
  to?: string;
  buildingId?: string;
  channel?: PaymentChannel;
  buildings: { id: string; name: string }[];
  openPaymentId?: string;
}) {
  const [rows, leases] = await Promise.all([
    listPayments({ status: props.status, from: props.from, to: props.to, buildingId: props.buildingId, channel: props.channel }),
    listAssignableLeases(),
  ]);
  const leaseOptions = leases.map((lease) => ({ value: lease.leaseId, label: `${lease.unitCode} · ${lease.tenantName}${lease.status === "ended" ? " (moved out)" : ""}` }));
  return (
    <>
      <FilterBar
        hidden={{ tab: props.status === "all" ? undefined : props.status }}
        fields={[
          { name: "from", label: "From", type: "date", value: props.from },
          { name: "to", label: "To", type: "date", value: props.to },
          { name: "building", label: "Building", type: "select", value: props.buildingId, options: [{ value: "", label: "All buildings" }, ...props.buildings.map((building) => ({ value: building.id, label: building.name }))] },
          { name: "channel", label: "Channel", type: "select", value: props.channel, options: [{ value: "", label: "All channels" }, ...CHANNELS.map((value) => ({ value, label: value === "stk" ? "M-Pesa prompt" : value === "paybill" ? "Paybill" : value === "bank" ? "Bank" : "Cash" }))] },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title={props.status === "unmatched" ? "No unmatched payments" : "No payments found"} description={props.status === "unmatched" ? "Every payment has been matched to a lease." : undefined} />
      ) : (
        <ResponsiveTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "who",
              header: "Unit",
              primary: true,
              cell: (row) =>
                row.tenantId ? (
                  <span className="flex flex-col gap-1">
                    <Link href={`/admin/tenants/${row.tenantId}`}>{row.unitCode} · {row.tenantName}</Link>
                    {row.paidByOther ? <PaidByOtherTag /> : null}
                  </span>
                ) : (
                  <span>Account “{row.accountReference || "blank"}”</span>
                ),
            },
            { key: "date", header: "Date", cell: (row) => formatNairobiDateTime(row.paidAt) },
            {
              key: "payer",
              header: "Payer",
              cell: (row) =>
                row.paidByOther ? (
                  <PaidByOtherNote paidByOther payerName={row.payerName} payerPhone={row.payerPhone} className="text-sm text-foreground" />
                ) : (
                  [row.payerName, row.payerPhone].filter(Boolean).join(" ") || "–"
                ),
            },
            { key: "ref", header: "Reference", cell: (row) => row.mpesaReceipt ?? row.channel },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.receiptVoided ? "void" : row.matchStatus} /> },
            { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
            {
              key: "actions",
              header: "",
              cell: (row) => (
                <div className="flex flex-wrap justify-end gap-2">
                  {row.receiptToken && !row.receiptVoided ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/receipts/${row.receiptToken}`} target="_blank">{row.receiptNumber}</Link>
                    </Button>
                  ) : null}
                  {row.matchStatus === "unmatched" ? (
                    <ActionForm
                      action={assignPaymentAction}
                      submitLabel="Assign"
                      dialog={{ trigger: "Assign", title: "Assign payment to a lease", triggerVariant: "default", defaultOpen: row.id === props.openPaymentId }}
                      confirm={{ title: "Assign this payment?", description: "It will be posted to the lease and a receipt sent to the tenant." }}
                      fields={[
                        { name: "paymentId", label: "", type: "hidden", defaultValue: row.id },
                        { name: "leaseId", label: "Lease", type: "select", required: true, placeholder: "Choose a lease", options: leaseOptions },
                      ]}
                    />
                  ) : null}
                  {row.matchStatus !== "reversed" && row.matchStatus !== "imported" ? (
                    <ActionForm
                      action={reversePaymentAction}
                      submitLabel="Reverse"
                      dialog={{ trigger: "Reverse", title: "Reverse payment", triggerVariant: "ghost" }}
                      confirm={{ title: "Reverse this payment?", description: "Its allocations are undone, the receipt is voided and the tenant is told. This can't be undone.", destructive: true }}
                      fields={[
                        { name: "paymentId", label: "", type: "hidden", defaultValue: row.id },
                        { name: "reason", label: "Reason", type: "textarea", required: true },
                      ]}
                    />
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

async function ClaimList() {
  const claims = await listPaymentClaims({ status: "all" });
  const slipUrls = new Map(
    await Promise.all(claims.filter((claim) => claim.hasSlip).map(async (claim) => [claim.id, await getClaimSlipUrl(claim.id)] as const)),
  );
  if (claims.length === 0) return <EmptyState title="No payment claims" description="Tenants report bank and cash payments here." />;
  return (
    <ResponsiveTable
      rows={claims}
      rowKey={(row) => row.id}
      columns={[
        { key: "who", header: "Tenant", primary: true, cell: (row) => `${row.unitCode} · ${row.tenantName}` },
        { key: "paidOn", header: "Paid on", cell: (row) => formatDate(row.paidOn) },
        { key: "method", header: "Method", cell: (row) => `${row.method}${row.reference ? ` · ${row.reference}` : ""}` },
        {
          key: "slip",
          header: "Slip",
          cell: (row) => {
            const url = slipUrls.get(row.id);
            return url ? <a href={url} target="_blank" rel="noreferrer">View slip</a> : "–";
          },
        },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
        {
          key: "actions",
          header: "",
          cell: (row) =>
            row.status === "waiting" ? (
              <div className="flex flex-wrap justify-end gap-2">
                <ActionForm
                  action={confirmClaimAction}
                  submitLabel="Confirm"
                  inline
                  confirm={{ title: "Confirm this payment?", description: `KES ${row.amount.toLocaleString("en-KE")} will be recorded for ${row.unitCode} and a receipt sent.` }}
                  fields={[{ name: "claimId", label: "", type: "hidden", defaultValue: row.id }]}
                />
                <ActionForm
                  action={rejectClaimAction}
                  submitLabel="Reject"
                  dialog={{ trigger: "Reject", title: "Reject claim", triggerVariant: "ghost" }}
                  confirm={{ title: "Reject this claim?", description: "The tenant gets an SMS with your reason.", destructive: true }}
                  fields={[
                    { name: "claimId", label: "", type: "hidden", defaultValue: row.id },
                    { name: "reason", label: "Reason (sent to the tenant)", type: "textarea", required: true },
                  ]}
                />
              </div>
            ) : row.reason ? (
              <span className="text-xs text-muted-foreground">{row.reason}</span>
            ) : null,
        },
      ]}
    />
  );
}

async function RequestList() {
  const requests = await listPaymentRequests();
  if (requests.length === 0) return <EmptyState title="No M-Pesa requests yet" />;
  return (
    <ResponsiveTable
      rows={requests}
      rowKey={(row) => row.id}
      columns={[
        { key: "who", header: "Tenant", primary: true, cell: (row) => `${row.unitCode} · ${row.tenantName}` },
        { key: "sent", header: "Sent", cell: (row) => formatNairobiDateTime(row.createdAt) },
        { key: "phone", header: "Phone", cell: (row) => `0${row.phone.slice(3)}` },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        { key: "result", header: "Result", cell: (row) => row.resultDescription ?? "–" },
        { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
      ]}
    />
  );
}
