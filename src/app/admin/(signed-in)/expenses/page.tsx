import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { createExpenseAction, deleteExpenseAction, updateExpenseAction } from "@/app/admin/actions/expenses";
import { ActionForm } from "@/components/shared/action-form";
import type { FormFieldConfig } from "@/components/shared/action-types";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ResponsiveTable } from "@/components/shared/responsive-table";
import { listExpenses } from "@/services/expenses";
import { listBuildings, listUnitOptions } from "@/services/tenancy";
import { firstDayOfPeriod, formatDate, isIsoDate, periodOf, todayInNairobi } from "@/utilities/dates";
import { sumShillings } from "@/utilities/money";

export const metadata: Metadata = { title: "Expenses" };

const CATEGORIES = ["Repairs", "Cleaning", "Security", "Water bill", "Electricity", "Garbage collection", "Caretaker", "Insurance", "Land rates", "Other"];

export default async function ExpensesPage({ searchParams }: PageProps<"/admin/expenses">) {
  const query = await searchParams;
  const today = todayInNairobi();
  const from = typeof query.from === "string" && isIsoDate(query.from) ? query.from : firstDayOfPeriod(periodOf(today));
  const to = typeof query.to === "string" && isIsoDate(query.to) ? query.to : today;
  const buildingId = typeof query.building === "string" && query.building ? query.building : undefined;
  const [expenses, buildings, units] = await Promise.all([listExpenses({ from, to, buildingId }), listBuildings(), listUnitOptions()]);

  const fields = (values?: (typeof expenses)[number]): FormFieldConfig[] => [
    { name: "buildingId", label: "Building", type: "select", required: true, defaultValue: values?.buildingId ?? buildings[0]?.id, options: buildings.map((b) => ({ value: b.id, label: b.name })), span: "half" },
    { name: "unitId", label: "Unit (optional)", type: "select", defaultValue: values?.unitId ?? "", options: [{ value: "", label: "Whole building" }, ...units.map((u) => ({ value: u.unitId, label: `${u.code} · ${u.buildingName}` }))], span: "half" },
    { name: "category", label: "Category", type: "select", required: true, defaultValue: values?.category ?? "Repairs", options: CATEGORIES.includes(values?.category ?? "Repairs") ? CATEGORIES.map((c) => ({ value: c, label: c })) : [...CATEGORIES, values?.category ?? ""].map((c) => ({ value: c, label: c })), span: "half" },
    { name: "amount", label: "Amount (KES)", type: "number", required: true, defaultValue: values?.amount, span: "half" },
    { name: "spentOn", label: "Date", type: "date", required: true, defaultValue: values?.spentOn ?? today, span: "half" },
    { name: "note", label: "Note", type: "textarea", defaultValue: values?.note },
  ];
  const addButton = buildings.length ? (
    <ActionForm action={createExpenseAction} submitLabel="Add expense" fields={fields()} dialog={{ trigger: "Add expense", title: "Add an expense", triggerVariant: "default" }} />
  ) : null;

  return (
    <>
      <PageHeader title="Expenses" description={`${formatDate(from)} – ${formatDate(to)}`} actions={addButton} />
      <FilterBar
        fields={[
          { name: "from", label: "From", type: "date", value: from },
          { name: "to", label: "To", type: "date", value: to },
          { name: "building", label: "Building", type: "select", value: buildingId, options: [{ value: "", label: "All buildings" }, ...buildings.map((b) => ({ value: b.id, label: b.name }))] },
        ]}
      />
      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses in this period" action={addButton} />
      ) : (
        <>
          <ResponsiveTable
            rows={expenses}
            rowKey={(row) => row.id}
            columns={[
              { key: "category", header: "Category", primary: true, cell: (row) => row.category },
              { key: "date", header: "Date", cell: (row) => formatDate(row.spentOn) },
              { key: "where", header: "Building / unit", cell: (row) => `${row.buildingName}${row.unitCode ? ` · ${row.unitCode}` : ""}` },
              { key: "note", header: "Note", cell: (row) => row.note ?? "–" },
              { key: "amount", header: "Amount", align: "right", cell: (row) => <Money amount={row.amount} /> },
              {
                key: "actions",
                header: "",
                cell: (row) => (
                  <div className="flex justify-end gap-2">
                    <ActionForm
                      action={updateExpenseAction}
                      submitLabel="Save"
                      dialog={{ trigger: "Edit", title: "Edit expense", triggerVariant: "ghost" }}
                      fields={[{ name: "expenseId", label: "", type: "hidden", defaultValue: row.id }, ...fields(row)]}
                    />
                    <ActionForm
                      action={deleteExpenseAction}
                      submitLabel="Delete"
                      submitVariant="ghost"
                      inline
                      confirm={{ title: "Delete this expense?", description: `${row.category}, KES ${row.amount.toLocaleString("en-KE")} on ${formatDate(row.spentOn)}. A copy is kept in the audit log.`, destructive: true }}
                      fields={[{ name: "expenseId", label: "", type: "hidden", defaultValue: row.id }]}
                    />
                  </div>
                ),
              },
            ]}
          />
          <p className="mt-3 text-right text-sm">
            Total <Money amount={sumShillings(expenses.map((row) => row.amount))} className="font-semibold" />
          </p>
        </>
      )}
    </>
  );
}
