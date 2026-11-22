"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { moveOutAction, previewMoveOutAction } from "@/app/admin/actions/tenancy";
import { selectClassName } from "@/components/shared/action-types";
import { useServerForm } from "@/components/shared/use-server-form";
import { FieldError } from "@/components/shared/action-form";
import { DetailList } from "@/components/shared/detail-list";
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
import { WizardSteps } from "./wizard-steps";

export type CurrentLease = { leaseId: string; unitCode: string; tenantName: string; buildingName: string; meterNumber: string | null; moveOutDate: string | null; status: string };

type Summary = {
  invoiceNumber: string;
  finalWater: { previousReading: number; finalReading: number; consumption: number; amount: number } | null;
  unusedDaysCredit: number;
  deductions: number;
  depositHeld: number;
  depositApplied: number;
  depositRefundDue: number;
  closingBalance: number;
  creditOwedToTenant: number;
};

const STEPS = ["Lease", "Final reading", "Deductions", "Deposit summary", "Confirm"];
const FIELD_STEP: Record<string, number> = { leaseId: 0, moveOutDate: 1, finalReading: 1 };

export function MoveOutWizard({ leases, initialLeaseId, today }: { leases: CurrentLease[]; initialLeaseId?: string; today: string }) {
  const [step, setStep] = useState(0);
  const [leaseId, setLeaseId] = useState(leases.some((lease) => lease.leaseId === initialLeaseId) ? (initialLeaseId as string) : (leases[0]?.leaseId ?? ""));
  const lease = leases.find((item) => item.leaseId === leaseId);
  const [deductions, setDeductions] = useState<{ key: number; description: string; amount: string }[]>([]);
  const { state: previewState, pending: previewing, submit: submitPreview } = useServerForm(previewMoveOutAction);
  const { state: saveState, pending: saving, submit: submitSave } = useServerForm(moveOutAction);
  const [confirming, setConfirming] = useState(false);
  const [finalReading, setFinalReading] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(0);

  useEffect(() => {
    for (const state of [previewState, saveState]) {
      if (!state.at || state.at <= seen.current) continue;
      seen.current = state.at;
      if (state.status === "error") {
        if (state.message) toast.error(state.message);
        const first = Object.keys(state.fieldErrors ?? {})[0];
        setNotice(first ? undefined : state.message);
        if (first) setStep(first.startsWith("deductions") ? 2 : (FIELD_STEP[first] ?? 0));
        else setStep(/reading/i.test(state.message ?? "") ? 1 : 2);
      }
    }
  }, [previewState, saveState]);

  // Move to the summary step from inside the action (changing it in onClick would swap the button before the browser submits).
  const runPreview = () => {
    if (!formRef.current) return;
    setNotice(undefined);
    setStep(3);
    submitPreview(new FormData(formRef.current));
  };

  const errors: Record<string, string | undefined> = { ...previewState.fieldErrors, ...saveState.fieldErrors };
  if (localError) errors.finalReading = localError;
  const summary = previewState.status === "success" ? (previewState.data as unknown as Summary) : null;
  const visible = (index: number) => (index === step ? "grid" : "hidden");

  if (leases.length === 0) return <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No current leases.</p>;

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="rounded-xl border bg-card p-4 sm:p-6" noValidate>
      <WizardSteps steps={STEPS} current={step} />

      <div className={`${visible(0)} gap-1.5`}>
        <Label htmlFor="move-out-lease">Lease</Label>
        <select id="move-out-lease" name="leaseId" value={leaseId} onChange={(event) => setLeaseId(event.target.value)} className={selectClassName}>
          {leases.map((item) => (
            <option key={item.leaseId} value={item.leaseId}>
              {item.unitCode} · {item.tenantName}
              {item.status === "notice" ? " (on notice)" : ""}
            </option>
          ))}
        </select>
        <FieldError id="move-out-lease-error" message={errors.leaseId} />
      </div>

      <div className={`${visible(1)} gap-4 sm:grid-cols-2`}>
        <div className="grid gap-1.5">
          <Label htmlFor="move-out-date">Move-out date</Label>
          <Input id="move-out-date" type="date" name="moveOutDate" defaultValue={lease?.moveOutDate ?? today} key={leaseId} aria-invalid={Boolean(errors.moveOutDate) || undefined} />
          <FieldError id="move-out-date-error" message={errors.moveOutDate} />
        </div>
        {lease?.meterNumber ? (
          <div className="grid gap-1.5">
            <Label htmlFor="move-out-reading">Final water reading ({lease.meterNumber})</Label>
            <Input
              id="move-out-reading"
              name="finalReading"
              inputMode="numeric"
              value={finalReading}
              onChange={(event) => {
                setFinalReading(event.target.value.replace(/[^\d]/g, ""));
                setLocalError(undefined);
              }}
              aria-invalid={Boolean(errors.finalReading) || undefined}
            />
            <FieldError id="move-out-reading-error" message={errors.finalReading} />
          </div>
        ) : (
          <p className="self-end text-sm text-muted-foreground">This unit has no water meter.</p>
        )}
      </div>

      <div className={`${visible(2)} gap-3`}>
        <p className="text-sm text-muted-foreground">Charges taken from the deposit, e.g. repairs or cleaning. Leave empty if none.</p>
        {deductions.map((item, index) => (
          <div key={item.key} className="grid grid-cols-[1fr_8rem_auto] items-start gap-2">
            <div>
              <Input name="descriptions[]" aria-label="Description" placeholder="Repaint living room" value={item.description} onChange={(event) => setDeductions((all) => all.map((row) => (row.key === item.key ? { ...row, description: event.target.value } : row)))} />
              <FieldError id={`deduction-${index}`} message={errors[`deductions.${index}`]} />
            </div>
            <Input name="amounts[]" aria-label="Amount (KES)" inputMode="numeric" placeholder="KES" value={item.amount} onChange={(event) => setDeductions((all) => all.map((row) => (row.key === item.key ? { ...row, amount: event.target.value.replace(/[^\d]/g, "") } : row)))} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setDeductions((all) => all.filter((row) => row.key !== item.key))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setDeductions((all) => [...all, { key: Date.now(), description: "", amount: "" }])}>
          <Plus /> Add deduction
        </Button>
      </div>

      <div className={`${visible(3)} gap-4`}>
        {summary ? (
          <DetailList
            items={[
              ["Final invoice", summary.invoiceNumber],
              ["Final water", summary.finalWater ? <span key="water">{summary.finalWater.consumption} units · <Money amount={summary.finalWater.amount} /></span> : "None"],
              ["Unused days credit", <Money key="unused" amount={summary.unusedDaysCredit} />],
              ["Deductions", <Money key="deductions" amount={summary.deductions} />],
              ["Deposit held", <Money key="held" amount={summary.depositHeld} />],
              ["Deposit applied to balance", <Money key="applied" amount={summary.depositApplied} />],
              ["Deposit to refund", <Money key="refund" amount={summary.depositRefundDue} className="font-semibold text-status-paid" />],
              ["Balance after move-out", <Money key="balance" amount={summary.closingBalance} balance className="font-semibold" />],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Working out the deposit summary…</p>
        )}
      </div>

      <div className={`${visible(4)} gap-2`}>
        <p className="text-sm">
          Ending the lease for <strong>{lease?.tenantName}</strong> in <strong>{lease?.unitCode}</strong>. The unit becomes vacant and the tenant gets a final statement by SMS.
        </p>
        {summary ? (
          <p className="text-sm">
            Deposit to refund: <Money amount={summary.depositRefundDue} className="font-semibold" /> · Balance: <Money amount={summary.closingBalance} balance className="font-semibold" />
          </p>
        ) : null}
      </div>

      {notice ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-status-overdue-surface px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      ) : null}

      <div className="mt-6 flex justify-between gap-2">
        <Button key="back" type="button" variant="outline" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>
          Back
        </Button>
        {step < 2 ? (
          <Button
            key="next"
            type="button"
            onClick={() => {
              if (step === 1 && lease?.meterNumber && finalReading === "") {
                setLocalError("Enter the final meter reading");
                return;
              }
              setStep((value) => value + 1);
            }}
          >
            Next
          </Button>
        ) : step === 2 ? (
          <Button key="preview" type="button" onClick={runPreview} disabled={previewing}>
            {previewing ? <Loader2 className="animate-spin" /> : null} See deposit summary
          </Button>
        ) : step === 3 ? (
          <Button key="to-confirm" type="button" disabled={!summary || previewing} onClick={() => setStep(4)}>
            Next
          </Button>
        ) : (
          <Button key="confirm" type="button" variant="destructive" disabled={!summary || saving} onClick={() => setConfirming(true)}>
            {saving ? <Loader2 className="animate-spin" /> : null} Move out
          </Button>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this lease?</AlertDialogTitle>
            <AlertDialogDescription>Final charges and the deposit are posted now. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setConfirming(false);
                if (formRef.current) submitSave(new FormData(formRef.current));
              }}
            >
              Move out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
