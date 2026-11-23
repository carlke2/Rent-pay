import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { TableSkeleton } from "@/components/shared/list-skeleton";
import { ListAnchor, Pagination, paramsKey } from "@/components/shared/pagination";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { MESSAGE_TEMPLATES, pageMessages } from "@/services/notifications";
import { formatNairobiDateTime } from "@/utilities/dates";
import { readPageRequest, type SearchParams } from "@/utilities/pagination";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  const query = await searchParams;
  const search = typeof query.search === "string" ? query.search : "";
  const template = typeof query.template === "string" && MESSAGE_TEMPLATES.some((item) => item.template === query.template) ? query.template : "";

  return (
    <>
      <PageHeader title="Messages" description="Every SMS sent, with its delivery status. Login codes are stored hidden." />
      <FilterBar
        fields={[
          { name: "search", label: "Tenant", type: "search", value: search, placeholder: "Name or phone" },
          { name: "template", label: "Message type", type: "select", value: template, options: [{ value: "", label: "All types" }, ...MESSAGE_TEMPLATES.map((item) => ({ value: item.template, label: item.name }))] },
        ]}
      />
      <ListAnchor id="messages-list">
        <Suspense key={paramsKey(query)} fallback={<TableSkeleton />}>
          <MessageRows search={search} template={template} params={query} />
        </Suspense>
      </ListAnchor>
    </>
  );
}

async function MessageRows({ search, template, params }: { search: string; template: string; params: SearchParams }) {
  const page = await pageMessages({ search, template: template || undefined }, readPageRequest(params));
  const messages = page.rows;
  const names = new Map<string, string>(MESSAGE_TEMPLATES.map((item) => [item.template, item.name]));
  return (
    <>
      {messages.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No messages" description={search || template ? "Try other filters." : "Messages appear here once SMS start going out."} />
      ) : (
        <ResponsiveTable
          rows={messages}
          rowKey={(row) => row.id}
          columns={[
            { key: "to", header: "To", primary: true, cell: (row) => (row.tenantName ? `${row.tenantName} · ${row.unitCode}` : `0${row.recipient.slice(3)}`) },
            { key: "time", header: "Sent", cell: (row) => formatNairobiDateTime(row.createdAt) },
            { key: "type", header: "Type", cell: (row) => names.get(row.template) ?? row.template },
            { key: "body", header: "Message", cell: (row) => <span className="line-clamp-3 max-w-md text-left text-sm whitespace-normal [overflow-wrap:anywhere]">{row.body}</span> },
            { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
          ]}
        />
      )}
      {messages.length > 0 ? <Pagination info={page.info} params={params} pathname="/admin/messages" anchor="messages-list" /> : null}
    </>
  );
}
