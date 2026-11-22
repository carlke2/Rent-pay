import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { listMessages, MESSAGE_TEMPLATES } from "@/services/notifications";
import { formatNairobiDateTime } from "@/utilities/dates";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  const query = await searchParams;
  const search = typeof query.search === "string" ? query.search : "";
  const template = typeof query.template === "string" && MESSAGE_TEMPLATES.some((item) => item.template === query.template) ? query.template : "";
  const messages = await listMessages({ search, template: template || undefined });
  const names = new Map<string, string>(MESSAGE_TEMPLATES.map((item) => [item.template, item.name]));

  return (
    <>
      <PageHeader title="Messages" description="Every SMS sent, with its delivery status. Login codes are stored hidden." />
      <FilterBar
        fields={[
          { name: "search", label: "Tenant", type: "search", value: search, placeholder: "Name or phone" },
          { name: "template", label: "Message type", type: "select", value: template, options: [{ value: "", label: "All types" }, ...MESSAGE_TEMPLATES.map((item) => ({ value: item.template, label: item.name }))] },
        ]}
      />
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
    </>
  );
}
