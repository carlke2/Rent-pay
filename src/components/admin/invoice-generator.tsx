"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateInvoicesAction } from "@/app/admin/actions/billing";
import { useServerForm } from "@/components/shared/use-server-form";
import { FieldError } from "@/components/shared/action-form";
import { Money } from "@/components/shared/money";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shared/ui/alert-dialog";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";

type Preview = {
  period: string;
  created: number;
  skipped: number;
  totalBilled: number;
  missingReadings: string[];
  flaggedReadings: string[];
  invoices: { unitCode: string; total: number; lines: { type: string; amount: number }[] }[];
};

/** Generate invoices: preview (dry run) first, then confirm to create them. */
export function InvoiceGenerator({ defaultPeriod }: { defaultPeriod: string }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const { state: previewState, pending: previewing, onSubmit: onPreview } = useServerForm(generateInvoicesAction);
  const { state: createState, pending: creating, submit: submitCreate } = useServerForm(generateInvoicesAction);
  const [confirming, setConfirming] = useState(false);
  const createForm = useRef<HTMLFormElement>(null);
  const seen = useRef<number | undefined>(undefined);
  const preview = previewState.status === "success" ? (previewState.data as unknown as Preview) : null;
  const done = createState.status === "success" && createState.at && preview && createState.at > (previewState.at ?? 0);

  useEffect(() => {
    for (const state of [previewState, createState]) {
      if (!state.at || (seen.current ?? 0) >= state.at) continue;
      seen.current = state.at;
      if (state.status === "error" && state.message) toast.error(state.message);
      if (state.status === "success" && state === createState && state.message) toast.success(state.message);
    }
  }, [previewState, createState]);

  return (
    <section className="mb-6 rounded-xl border bg-card p-4 sm:p-5 print:hidden">
      <h2 className="mb-1 font-semibold">Generate invoices</h2>
      <p className="mb-4 text-sm text-muted-foreground">Preview what will be billed, then create the invoices. Leases already billed for the month are skipped.</p>
      <form onSubmit={onPreview} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="dryRun" value="true" />
        <div className="grid gap-1.5">
          <Label htmlFor="generate-period">Month</Label>
          <Input id="generate-period" type="month" name="period" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-44" aria-invalid={Boolean(previewState.fieldErrors?.period) || undefined} />
          <FieldError id="generate-period-error" message={previewState.fieldErrors?.period} />
        </div>
        <Button type="submit" variant="outline" disabled={previewing}>
          {previewing ? <Loader2 className="animate-spin" /> : null} Preview
        </Button>
      </form>

      {preview && preview.period === period && !done ? (
        <div className="mt-4 grid gap-3">
          {preview.missingReadings.length || preview.flaggedReadings.length ? (
            <div className="rounded-lg border border-status-partial/30 bg-status-partial-surface p-3 text-sm text-status-partial">
              {preview.missingReadings.length ? <p>No water reading for: {preview.missingReadings.join(", ")} (water left off).</p> : null}
              {preview.flaggedReadings.length ? <p>Readings waiting for confirmation: {preview.flaggedReadings.join(", ")} (water left off).</p> : null}
            </div>
          ) : null}
          {preview.created === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to bill: {preview.skipped} leases already have an invoice for this month.</p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {preview.invoices.map((invoice) => (
                  <li key={invoice.unitCode} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">{invoice.unitCode}</span>
                    <span className="text-muted-foreground">{invoice.lines.map((line) => `${line.type} ${line.amount.toLocaleString("en-KE")}`).join(" + ")}</span>
                    <Money amount={invoice.total} className="font-medium" />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {preview.created} invoices, total <Money amount={preview.totalBilled} className="font-semibold" />
                  {preview.skipped ? <span className="text-muted-foreground"> · {preview.skipped} already billed</span> : null}
                </p>
                <form ref={createForm} onSubmit={(event) => event.preventDefault()}>
                  <input type="hidden" name="period" value={preview.period} />
                  <Button type="button" disabled={creating} onClick={() => setConfirming(true)}>
                    {creating ? <Loader2 className="animate-spin" /> : null} Create {preview.created} invoices
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create {preview?.created} invoices?</AlertDialogTitle>
            <AlertDialogDescription>Charges are posted to each lease and tenants get an SMS with their bill.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                if (createForm.current) submitCreate(new FormData(createForm.current));
              }}
            >
              Create invoices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
