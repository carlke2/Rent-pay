import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waiveChargeAction } from "@/app/admin/actions/billing";
import { recordPaymentAction, sendStatementAction } from "@/app/admin/actions/payments";
import { SendReminderButton } from "@/components/admin/send-reminder-button";
import { removeTenantAvatarAction } from "@/app/admin/actions/tenancy";
import { Avatar } from "@/components/shared/avatar";
import { updateTenantAction } from "@/app/admin/actions/property";
import { ActionForm } from "@/components/shared/action-form";
import { DetailList, Panel } from "@/components/shared/detail-list";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { PaidByOtherNote } from "@/components/shared/paid-by-other";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { getLeaseStatementPage, listInvoicesForLease, listOpenLines } from "@/services/billing";
import { listMessages, pageMessages } from "@/services/notifications";
import { pagePaymentRequests, pagePayments } from "@/services/payments";
import { avatarUrl } from "@/services/avatars";
import { getTenantDetail } from "@/services/tenancy";
import { formatDate, formatNairobiDateTime, formatPeriod, isIsoDate, startOfNairobiDay, todayInNairobi } from "@/utilities/dates";
import { cn } from "@/utilities/class-names";
import { readPageRequest, slicePage } from "@/utilities/pagination";

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

  // Each list on this page pages on its own (ledger_page, inv_page, pay_page, req_page, msg_page in the URL).
  const [statement, allInvoices, paymentPage, requestPage, messagePage, recentReminders, openLines] = lease
    ? await Promise.all([
        // Passing the start date lets the ledger load in the same round as everything else.
        getLeaseStatementPage({ leaseId: lease.leaseId, from: from ?? lease.startDate, to }, readPageRequest(query, "ledger")),
        listInvoicesForLease(lease.leaseId),
        pagePayments({ leaseId: lease.leaseId }, readPageRequest(query, "pay")),
        pagePaymentRequests({ leaseId: lease.leaseId }, readPageRequest(query, "req")),
        pageMessages({ leaseId: lease.leaseId }, readPageRequest(query, "msg")),
        listMessages({ leaseId: lease.leaseId, template: "reminder_manual", limit: 5 }),
        listOpenLines(lease.leaseId),
      ])
    : [null, [], null, null, null, [], []];
  const invoicePage = slicePage(allInvoices, readPageRequest(query, "inv").page);
  const invoiceRows = invoicePage.rows;
  const payments = paymentPage?.rows ?? [];
  const requests = requestPage?.rows ?? [];
  const messages = messagePage?.rows ?? [];
  const isCurrent = lease && lease.status !== "ended";
  const startOfToday = startOfNairobiDay(today).getTime();
  const remindedToday = recentReminders.some(
    (message) => message.template === "reminder_manual" && ["sent", "delivered", "queued"].includes(message.status) && new Date(message.createdAt).getTime() >= startOfToday,
  );
  const localPhone = `0${tenant.phone.slice(3)}`;

  return (
    <>
      <PageHeader
        title={tenant.fullName}
        description={lease ? `${lease.unitCode} · ${lease.buildingName}` : "No lease"}
        back={{ href: "/admin/tenants", label: "Tenants" }}
        leading={<Avatar name={tenant.fullName} src={avatarUrl(tenant.id, tenant.avatarKey)} className="size-14 text-lg" alt={tenant.avatarKey ? `${tenant.fullName}'s photo` : ""} />}
        actions={
          <>
            {tenant.avatarKey ? (
              // The landlord can take a photo down, never upload one: only the tenant sets their photo.
              <ActionForm
                action={removeTenantAvatarAction}
                submitLabel="Remove photo"
                submitVariant="outline"
                inline
                confirm={{ title: "Remove this tenant's photo?", description: "The photo is deleted. The tenant can upload a new one from their profile.", confirmLabel: "Remove photo", destructive: true }}
                fields={[{ name: "tenantId", label: "", type: "hidden", defaultValue: tenant.id }]}
              />
            ) : null}
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
            <Link prefetch={false}
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
                ["Unit", <Link prefetch={false} key="unit" href={`/admin/units/${lease.unitId}`}>{lease.unitCode}</Link>],
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
        <Panel title="Statement" className="mt-4" id="tenant-ledger">
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
          {statement.entries.length > 0 ? (
            <Pagination info={statement.info} params={query} pathname={`/admin/tenants/${tenant.id}`} anchor="tenant-ledger" prefix="ledger" firstCursor={statement.firstCursor} lastCursor={statement.lastCursor} />
          ) : null}
        </Panel>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Invoices" id="tenant-invoices">
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
          {invoiceRows.length > 0 ? <Pagination info={invoicePage.info} params={query} pathname={`/admin/tenants/${tenant.id}`} anchor="tenant-invoices" prefix="inv" /> : null}
        </Panel>
        <Panel title="Receipts" id="tenant-payments">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments.</p>
          ) : (
            <ResponsiveTable
              rows={payments}
              rowKey={(row) => row.id}
              columns={[
                { key: "receipt", header: "Receipt", primary: true, cell: (row) => (row.receiptToken ? <Link prefetch={false} href={`/receipts/${row.receiptToken}`} target="_blank">{row.receiptNumber}</Link> : "–") },
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
          {paymentPage && payments.length > 0 ? (
            <Pagination info={paymentPage.info} params={query} pathname={`/admin/tenants/${tenant.id}`} anchor="tenant-payments" prefix="pay" firstCursor={paymentPage.firstCursor} lastCursor={paymentPage.lastCursor} />
          ) : null}
        </Panel>
        <Panel title="Payment requests" id="tenant-requests">
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
          {requestPage && requests.length > 0 ? <Pagination info={requestPage.info} params={query} pathname={`/admin/tenants/${tenant.id}`} anchor="tenant-requests" prefix="req" /> : null}
        </Panel>
        <Panel title="Messages" id="tenant-messages">
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
          {messagePage && messages.length > 0 ? <Pagination info={messagePage.info} params={query} pathname={`/admin/tenants/${tenant.id}`} anchor="tenant-messages" prefix="msg" /> : null}
        </Panel>
      </div>
    </>
  );
}
