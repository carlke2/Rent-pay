"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmMeterReadingAction, saveMeterReadingsAction } from "@/app/admin/actions/billing";
import { IDLE } from "@/components/shared/action-types";
import { useServerForm } from "@/components/shared/use-server-form";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { assessReading, waterCharge } from "@/core/billing";
import { cn } from "@/utilities/class-names";

export type SheetRow = {
  unitId: string;
  code: string;
  meterNumber: string | null;
  previousReading: number | null;
  recentConsumptions: number[];
  saved: { readingId: string; currentReading: number; flagged: boolean; confirmed: boolean } | null;
};

const FLAG_TEXT = { lower_than_previous: "Lower than last reading", unusually_high: "Over 3× the usual use" } as const;

/** One row per unit: type the reading and see consumption, amount and any flag straight away (core/billing rules). */
export function MeterReadingSheet({
  period,
  rows,
  ratePerUnit,
  standingCharge,
  highlightUnitId,
}: {
  period: string;
  rows: SheetRow[];
  ratePerUnit: number;
  standingCharge: number;
  /** A unit to scroll to and outline (the overview's "Check" button). */
  highlightUnitId?: string;
}) {
  useEffect(() => {
    if (highlightUnitId) document.getElementById(`reading-${highlightUnitId}`)?.scrollIntoView({ block: "center" });
  }, [highlightUnitId]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.unitId, row.saved ? String(row.saved.currentReading) : ""])),
  );
  const { state, pending, onSubmit } = useServerForm(saveMeterReadingsAction);
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.at || state.at === seen.current) return;
    seen.current = state.at;
    if (state.message) (state.status === "success" ? toast.success : toast.error)(state.message);
  }, [state]);

  const metered = rows.filter((row) => row.meterNumber);
  const flaggedSaved = rows.filter((row) => row.saved && !row.saved.confirmed);

  return (
    <>
      <form onSubmit={onSubmit}>
        <input type="hidden" name="period" value={period} />
        {state.fieldErrors?.form ? <p className="mb-3 text-sm text-destructive">{state.fieldErrors.form}</p> : null}
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[1fr_7rem_8rem_6rem_7rem_12rem] gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
            <span>Unit</span>
            <span className="text-right">Previous</span>
            <span>Current</span>
            <span className="text-right">Used</span>
            <span className="text-right">Amount</span>
            <span>Check</span>
          </div>
          <ul className="divide-y">
            {metered.map((row) => {
              const raw = values[row.unitId] ?? "";
              const current = /^\d+$/.test(raw) ? Number(raw) : null;
              const previous = row.previousReading;
              const assessment = current !== null && previous !== null ? assessReading({ previousReading: previous, currentReading: current, recentConsumptions: row.recentConsumptions }) : null;
              const amount = assessment ? waterCharge({ consumption: assessment.consumption, ratePerUnit, standingCharge }).total : null;
              const error = state.fieldErrors?.[`reading.${row.unitId}`];
              return (
                <li
                  key={row.unitId}
                  id={`reading-${row.unitId}`}
                  className={cn(
                    "grid grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[1fr_7rem_8rem_6rem_7rem_12rem]",
                    row.unitId === highlightUnitId && "bg-surface-raised shadow-[inset_3px_0_0_var(--status-partial-border)]",
                  )}
                >
                  <div className="col-span-2 md:col-span-1">
                    <span className="font-medium">{row.code}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{row.meterNumber}</span>
                  </div>
                  <span className="text-sm text-muted-foreground md:text-right">
                    <span className="md:hidden">Previous </span>
                    {previous ?? "none"}
                  </span>
                  <div>
                    <input type="hidden" name="unitIds[]" value={row.unitId} />
                    <Input
                      name="readings[]"
                      inputMode="numeric"
                      aria-label={`Current reading for ${row.code}`}
                      value={raw}
                      onChange={(event) => setValues((all) => ({ ...all, [row.unitId]: event.target.value.replace(/[^\d]/g, "") }))}
                      aria-invalid={Boolean(error) || undefined}
                      className="numbers"
                    />
                    {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                  </div>
                  <span className="numbers text-sm md:text-right">
                    <span className="text-muted-foreground md:hidden">Used </span>
                    {assessment ? assessment.consumption : "–"}
                  </span>
                  <span className="text-right text-sm">{amount !== null ? <Money amount={amount} /> : "–"}</span>
                  <div className="col-span-2 flex flex-wrap gap-1 md:col-span-1">
                    {assessment?.flags.map((flag) => <StatusBadge key={flag} status="flagged" label={FLAG_TEXT[flag]} />)}
                    {previous === null && current !== null ? <StatusBadge status="info" label="First reading" /> : null}
                    {row.saved ? <StatusBadge status={row.saved.confirmed ? "confirmed" : "waiting"} label={row.saved.confirmed ? "Saved" : "Needs confirming"} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            KES {ratePerUnit.toLocaleString("en-KE")} per unit{standingCharge ? ` + KES ${standingCharge.toLocaleString("en-KE")} standing charge` : ""}. Flagged readings are saved but wait for your confirmation.
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save all
          </Button>
        </div>
      </form>

      {flaggedSaved.length ? (
        <section className="mt-6 rounded-xl border border-status-partial/30 bg-status-partial-surface p-4">
          <h2 className="mb-2 font-semibold text-status-partial">Flagged readings to confirm</h2>
          <ul className="grid gap-2">
            {flaggedSaved.map((row) => (
              <li key={row.unitId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{row.code}</span>: {row.previousReading} → {row.saved?.currentReading}
                </span>
                <ConfirmButton readingId={row.saved?.readingId ?? ""} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ConfirmButton({ readingId }: { readingId: string }) {
  const [state, action, pending] = useActionState(confirmMeterReadingAction, IDLE);
  useEffect(() => {
    if (state.message) (state.status === "success" ? toast.success : toast.error)(state.message);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="readingId" value={readingId} />
      <Button size="sm" type="submit" disabled={pending}>
        Confirm reading
      </Button>
    </form>
  );
}
