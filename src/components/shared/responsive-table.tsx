import { cn } from "@/utilities/class-names";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./ui/table";

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  align?: "left" | "right";
  /** Shown as the card title on phones. */
  primary?: boolean;
  /** Left out of the phone card (e.g. duplicated information). */
  hideOnCard?: boolean;
  /** Buttons for the row: on phone cards they go full width at the bottom. A column keyed "actions" counts too. */
  action?: boolean;
};

const isAction = <Row,>(column: Column<Row>) => column.action || column.key === "actions";

/** A table on wider screens that becomes stacked cards on phones. */
export function ResponsiveTable<Row>({
  rows,
  columns,
  rowKey,
  footer,
  className,
}: {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  footer?: React.ReactNode;
  className?: string;
}) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const actions = columns.filter(isAction);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="hidden min-w-0 overflow-x-auto rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {columns.map((column) => (
                <TableHead key={column.key} className={cn("text-xs uppercase tracking-wide text-muted-foreground", column.align === "right" && "text-right")}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={cn("align-top", column.align === "right" && "text-right numbers")}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {footer ? <TableFooter>{footer}</TableFooter> : null}
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-xl border bg-card p-4">
            {primary ? <div className="mb-2 min-w-0 truncate font-medium">{primary.cell(row)}</div> : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              {columns
                .filter((column) => column !== primary && !column.hideOnCard && !isAction(column))
                .map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="truncate text-muted-foreground">{column.header}</dt>
                    <dd className="min-w-0 truncate text-right">{column.cell(row)}</dd>
                  </div>
                ))}
            </dl>
            {actions.map((column) => (
              <div key={column.key} className="mt-3 border-t pt-3 empty:hidden [&>*]:w-full [&>div]:flex [&>div]:flex-wrap [&>div]:justify-stretch [&>div>*]:flex-1">
                {column.cell(row)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
