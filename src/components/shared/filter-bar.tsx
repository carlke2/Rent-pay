import { selectClassName } from "./action-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export type FilterField =
  | { name: string; label: string; type: "text" | "date" | "month" | "search"; value?: string; placeholder?: string }
  | { name: string; label: string; type: "select"; value?: string; options: { value: string; label: string }[] };

/** A GET form for list filters: works without JavaScript and keeps filters in the URL. */
export function FilterBar({ fields, hidden = {} }: { fields: FilterField[]; hidden?: Record<string, string | undefined> }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3 print:hidden">
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      {fields.map((field) => (
        <div key={field.name} className="grid min-w-36 flex-1 gap-1 sm:flex-none">
          <Label htmlFor={`filter-${field.name}`} className="text-xs text-muted-foreground">
            {field.label}
          </Label>
          {field.type === "select" ? (
            <select id={`filter-${field.name}`} name={field.name} defaultValue={field.value ?? ""} className={selectClassName}>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Input id={`filter-${field.name}`} name={field.name} type={field.type} defaultValue={field.value} placeholder={"placeholder" in field ? field.placeholder : undefined} />
          )}
        </div>
      ))}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}
