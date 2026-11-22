import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiveChargeAction } from "@/app/admin/actions/billing";
import { recordPaymentAction, sendStatementAction } from "@/app/admin/actions/payments";
import { SendReminderButton } from "@/components/admin/send-reminder-button";
import { updateTenantAction } from "@/app/admin/actions/property";
import { ActionForm } from "@/components/shared/action-form";
import { DetailList, Panel } from "@/components/shared/detail-list";
import { FilterBar } from "@/components/shared/filter-bar";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { PaidByOtherNote } from "@/components/shared/paid-by-other";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { getLeaseStatement, listInvoicesForLease, listOpenLines } from "@/services/billing";
import { listMessages } from "@/services/notifications";
import { listPaymentRequests, listPayments } from "@/services/payments";
import { getTenantDetail } from "@/services/tenancy";
import { formatDate, formatNairobiDateTime, formatPeriod, isIsoDate, startOfNairobiDay, todayInNairobi } from "@/utilities/dates";
import { cn } from "@/utilities/class-names";

export const metadata: Metadata = { title: "Tenant" };

export default async function TenantPage({ params, searchParams }: PageProps<"/admin/tenants/[tenantId]">) {
  const { tenantId } = await params;
  const query = await searchParams;
  const detail = await getTenantDetail(tenantId);
  if (!detail) notFound();
  const { tenant } = detail;
  const lease = detail.leases.find((item) => item.leaseId === query.lease) ?? detail.leases[0] ?? null;
  const today = todayInNairobi();
  const from = typeof query.from === "string" && isIsoDate(query.from) ? query.from : undefined;
  const to = typeof query.to === "string" && isIsoDate(query.to) ? query.to : undefined;

  const [statement, invoiceRows, payments, requests, messages, openLines] = lease
    ? await Promise.all([
        getLeaseStatement({ leaseId: lease.leaseId, from, to }),
        listInvoicesForLease(lease.leaseId),
        listPayments({ leaseId: lease.leaseId, limit: 50 }),
        listPaymentRequests({ leaseId: lease.leaseId }),
        listMessages({ leaseId: lease.leaseId, limit: 30 }),
        listOpenLines(lease.leaseId),
      ])
    : [null, [], [], [], [], []];
  const isCurrent = lease && lease.status !== "ended";
  const startOfToday = startOfNairobiDay(today).getTime();
  const remindedToday = messages.some(
    (message) => message.template === "reminder_manual" && ["sent", "delivered", "queued"].includes(message.status) && new Date(message.createdAt).getTime() >= startOfToday,
  );
  const localPhone = `0${tenant.phone.slice(3)}`;

  return (
    <>
      <PageHeader
        title={tenant.fullName}
        description={lease ? `${lease.unitCode} · ${lease.buildingName}` : "No lease"}
        back={{ href: "/admin/tenants", label: "Tenants" }}
        actions={
          <>
            {lease && isCurrent ? <SendReminderButton leaseId={lease.leaseId} sentToday={remindedToday} variant="default" /> : null}
            {lease ? (
              <ActionForm
                action={recordPaymentAction}
                submitLabel="Record payment"
                dialog={{ trigger: "Record payment", title: "Record a bank or cash payment" }}
                confirm={{ title: "Record this payment?", description: "It will be allocated to open charges and a receipt sent to the tenant." }}
                fields={[
                  { name: "leaseId", label: "", type: "hidden", defaultValue: lease.leaseId },
                  { name: "amount", label: "Amount (KES)", type: "number", required: true, span: "half" },
                  { name: "paidOn", label: "Paid on", type: "date", required: true, defaultValue: today, span: "half" },
                  { name: "method", label: "Method", type: "select", required: true, defaultValue: "bank", span: "half", options: [{ value: "bank", label: "Bank" }, { value: "cash", label: "Cash" }] },
                  { name: "reference", label: "Reference", placeholder: "Bank slip or receipt number", span: "half" },
                ]}
              />
            ) : null}
            {lease && openLines.length ? (
              <ActionForm
                action={waiveChargeAction}
                submitLabel="Waive"
                dialog={{ trigger: "Waive charge", title: "Waive part of a charge" }}
                confirm={{ title: "Waive this amount?", description: "The amount is forgiven and taken off the tenant's balance. This is recorded in the audit log.", destructive: true }}
                fields={[
                  {
                    name: "invoiceLineId",
                    label: "Charge",
                    type: "select",
                    required: true,
                    placeholder: "Choose a charge",
                    options: openLines.map((line) => ({ value: line.invoiceLineId, label: `${line.invoiceNumber} · ${line.type} · KES ${line.open.toLocaleString("en-KE")} open` })),
                  },
                  { name: "amount", label: "Amount to waive (KES)", type: "number", required: true },
                  { name: "reason", label: "Reason", type: "textarea", required: true },
                ]}
              />
            ) : null}
            {lease ? (
              <ActionForm action={sendStatementAction} submitLabel="Send statement" submitVariant="outline" inline fields={[{ name: "leaseId", label: "", type: "hidden", defaultValue: lease.leaseId }]} />
            ) : null}
            <ActionForm
              action={updateTenantAction}
              submitLabel="Save tenant"
              dialog={{ trigger: "Edit", title: "Edit tenant" }}
              fields={[
                { name: "tenantId", label: "", type: "hidden", defaultValue: tenant.id },
                { name: "fullName", label: "Full name", required: true, defaultValue: tenant.fullName },
                { name: "phone", label: "Phone", type: "tel", required: true, defaultValue: localPhone, span: "half" },
                { name: "alternativePhone", label: "Alternative phone", type: "tel", defaultValue: tenant.alternativePhone ? `0${tenant.alternativePhone.slice(3)}` : "", span: "half" },
                { name: "nationalId", label: "National ID", defaultValue: tenant.nationalId, span: "half" },
                { name: "nextOfKinName", label: "Next of kin", defaultValue: tenant.nextOfKin?.name, span: "half" },
                { name: "nextOfKinPhone", label: "Next of kin phone", type: "tel", defaultValue: tenant.nextOfKin?.phone, span: "half" },
                { name: "whatsappOptIn", label: "WhatsApp messages", type: "checkbox", defaultValue: tenant.whatsappOptIn },
                { name: "portalAccess", label: "Tenant portal access", type: "checkbox", defaultValue: tenant.portalAccess },
              ]}
            />
          </>
        }
      />

      {detail.leases.length > 1 ? (
        <nav aria-label="Leases" className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {detail.leases.map((item) => (
            <Link
              key={item.leaseId}
              href={`/admin/tenants/${tenant.id}?lease=${item.leaseId}`}
              className={cn("inline-flex min-h-8 items-center rounded-full border bg-card px-3.5 text-sm pointer-coarse:min-h-11 whitespace-nowrap text-foreground no-underline", item.leaseId === lease?.leaseId && "border-brand bg-brand-surface text-brand")}
            >
              {item.unitCode} · {item.status === "ended" ? "moved out" : item.status}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Details">
          <DetailList
            items={[
              ["Phone", localPhone],
              ["Alternative", tenant.alternativePhone ? `0${tenant.alternativePhone.slice(3)}` : "–"],
              ["National ID", tenant.nationalId ?? "–"],
              ["Next of kin", tenant.nextOfKin ? `${tenant.nextOfKin.name} (${tenant.nextOfKin.phone})` : "–"],
              ["Portal", tenant.portalAccess ? "On" : "Off"],
              ["Last login", tenant.lastLoginAt ? formatNairobiDateTime(tenant.lastLoginAt) : "Never"],
            ]}
          />
        </Panel>
        {lease ? (
          <Panel title="Lease" className="lg:col-span-2">
            <DetailList
              items={[
                ["Unit", <Link key="unit" href={`/admin/units/${lease.unitId}`}>{lease.unitCode}</Link>],
                ["Status", <StatusBadge key="status" status={lease.status} label={lease.status === "ended" ? "Moved out" : undefined} />],
                ["Started", formatDate(lease.startDate)],
                ["Ends", lease.endDate ? formatDate(lease.endDate) : "–"],
                ["Balance", <Money key="balance" amount={lease.balance} balance className="text-base" />],
              ]}
            />
          </Panel>
        ) : null}
      </div>

      {statement ? (
        <Panel title="Statement" className="mt-4">
          <FilterBar
            hidden={{ lease: lease?.leaseId }}
            fields={[
              { name: "from", label: "From", type: "date", value: statement.from },
              { name: "to", label: "To", type: "date", value: statement.to },
            ]}
          />
          <ResponsiveTable
            rows={statement.entries}
            rowKey={(row) => row.id}
            columns={[
              { key: "date", header: "Date", primary: true, cell: (row) => formatDate(row.date) },
              { key: "description", header: "Description", cell: (row) => <span>{row.description ?? row.reference}{row.description && row.type !== "charge" ? <span className="text-muted-foreground"> · {row.reference}</span> : null}</span> },
              { key: "debit", header: "Charge", align: "right", cell: (row) => (row.debit ? <Money amount={row.debit} /> : "") },
              { key: "credit", header: "Paid / credit", align: "right", cell: (row) => (row.credit ? <Money amount={row.credit} className="text-status-paid" /> : "") },
              { key: "balance", header: "Balance", align: "right", cell: (row) => <Money amount={row.balance} balance /> },
            ]}
          />
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
            <span>
              Opening balance <Money amount={statement.openingBalance} balance className="font-medium" />
            </span>
            <span>
              Closing balance <Money amount={statement.closingBalance} balance className="font-semibold" />
            </span>
          </div>
        </Panel>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Invoices">
          {invoiceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices.</p>
          ) : (
            <ResponsiveTable
              rows={invoiceRows}
              rowKey={(row) => row.invoiceId}
              columns={[
                { key: "number", header: "Invoice", primary: true, cell: (row) => row.number },
                { key: "period", header: "Month", cell: (row) => formatPeriod(row.period) },
                { key: "total", header: "Total", align: "right", cell: (row) => <Money amount={row.total} /> },
                { key: "open", header: "Open", align: "right", cell: (row) => <Money amount={row.open} /> },
              ]}
            />
          )}
        </Panel>
        <Panel title="Receipts">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments.</p>
          ) : (
            <ResponsiveTable
              rows={payments}
              rowKey={(row) => row.id}
              columns={[
                { key: "receipt", header: "Receipt", primary: true, cell: (row) => (row.receiptToken ? <Link href={`/receipts/${row.receiptToken}`} target="_blank">{row.receiptNumber}</Link> : "–") },
                { key: "date", header: "Date", cell: (row) => formatNairobiDateTime(row.paidAt) },
                {
                  key: "channel",
                  header: "Channel",
                  cell: (row) => (
                    <>
                      {row.mpesaReceipt ?? row.channel}
                      <PaidByOtherNote paidByOther={row.paidByOther} payerName={row.payerName} payerPhone={row.payerPhone} />
                    </>
                  ),
                },
                { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.receiptVoided ? "void" : row.matchStatus} /> },
                { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
              ]}
            />
          )}
        </Panel>
        <Panel title="Payment requests">
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No M-Pesa requests.</p>
          ) : (
            <ResponsiveTable
              rows={requests}
              rowKey={(row) => row.id}
              columns={[
                { key: "date", header: "Sent", primary: true, cell: (row) => formatNairobiDateTime(row.createdAt) },
                { key: "phone", header: "Phone", cell: (row) => `0${row.phone.slice(3)}` },
                { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
                { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
              ]}
            />
          )}
        </Panel>
        <Panel title="Messages">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages.</p>
          ) : (
            <ul className="grid gap-2">
              {messages.map((message) => (
                <li key={message.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatNairobiDateTime(message.createdAt)} · {message.template.replace(/_/g, " ")}</span>
                    <StatusBadge status={message.status} />
                  </div>
                  <p className="[overflow-wrap:anywhere]">{message.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
