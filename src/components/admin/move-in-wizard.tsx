"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { moveInAction, previewMoveInAction } from "@/app/admin/actions/tenancy";
import { selectClassName } from "@/components/shared/action-types";
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
import { WizardSteps } from "./wizard-steps";

export type VacantUnit = { unitId: string; code: string; type: string; buildingName: string; rentAmount: number; depositAmount: number; meterNumber: string | null };

const FIELD_STEP: Record<string, number> = { unitId: 0, fullName: 1, phone: 1, nationalId: 1, alternativePhone: 1, startDate: 2, rentAmount: 2, depositAmount: 2, openingReading: 3 };

export function MoveInWizard({ units, initialUnitId, today }: { units: VacantUnit[]; initialUnitId?: string; today: string }) {
  const [step, setStep] = useState(0);
  const [unitId, setUnitId] = useState(units.some((unit) => unit.unitId === initialUnitId) ? (initialUnitId as string) : (units[0]?.unitId ?? ""));
  const unit = units.find((item) => item.unitId === unitId);
  const [rent, setRent] = useState(String(unit?.rentAmount ?? ""));
  const [deposit, setDeposit] = useState(String(unit?.depositAmount ?? ""));
  const { state: previewState, pending: previewing, submit: submitPreview } = useServerForm(previewMoveInAction);
  const { state: saveState, pending: saving, submit: submitSave } = useServerForm(moveInAction);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef(0);
  const steps = useMemo(() => ["Unit", "Tenant", "Terms", ...(unit?.meterNumber ? ["Opening reading"] : []), "Review"], [unit?.meterNumber]);
  const reviewStep = steps.length - 1;
  const stepIndex = (logical: number) => (logical === 3 && !unit?.meterNumber ? -1 : logical === 4 ? reviewStep : logical);

  useEffect(() => {
    for (const state of [previewState, saveState]) {
      if (!state.at || state.at <= seen.current) continue;
      seen.current = state.at;
      if (state.status === "error") {
        if (state.message) toast.error(state.message);
        const first = Object.keys(state.fieldErrors ?? {})[0];
        // Field errors go back to their step; other errors (e.g. from the service) go back one step with the message shown.
        setNotice(first ? undefined : state.message);
        setStep(first && FIELD_STEP[first] !== undefined ? Math.max(0, stepIndex(FIELD_STEP[first])) : Math.max(0, reviewStep - 1));
      }
    }
  }, [previewState, saveState]);

  // Move to the review step from inside the action (changing it in onClick would swap the button before the browser submits).
  const runPreview = () => {
    if (!formRef.current) return;
    setNotice(undefined);
    setStep(reviewStep);
    submitPreview(new FormData(formRef.current));
  };

  const errors: Record<string, string | undefined> = { ...previewState.fieldErrors, ...saveState.fieldErrors };
  if (localError) errors.openingReading = localError;
  const preview = previewState.status === "success" ? (previewState.data as { tenantIsNew: boolean; lines: { type: string; description: string; amount: number }[] }) : null;
  const visible = (logical: number) => (stepIndex(logical) === step ? "grid" : "hidden");

  function field(name: string, label: string, props: React.ComponentProps<typeof Input> = {}) {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`move-in-${name}`}>{label}</Label>
        <Input id={`move-in-${name}`} name={name} aria-invalid={Boolean(errors[name]) || undefined} {...props} />
        <FieldError id={`move-in-${name}-error`} message={errors[name]} />
      </div>
    );
  }

  if (units.length === 0) {
    return <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">There are no vacant units right now.</p>;
  }

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="rounded-xl border bg-card p-4 sm:p-6" noValidate>
      <WizardSteps steps={steps} current={step} />

      <div className={`${visible(0)} gap-4`}>
        <div className="grid gap-1.5">
          <Label htmlFor="move-in-unit">Vacant unit</Label>
          <select
            id="move-in-unit"
            name="unitId"
            value={unitId}
            className={selectClassName}
            onChange={(event) => {
              const next = units.find((item) => item.unitId === event.target.value);
              setUnitId(event.target.value);
              setRent(String(next?.rentAmount ?? ""));
              setDeposit(String(next?.depositAmount ?? ""));
            }}
          >
            {units.map((item) => (
              <option key={item.unitId} value={item.unitId}>
                {item.code} · {item.type} · {item.buildingName}
              </option>
            ))}
          </select>
          <FieldError id="move-in-unit-error" message={errors.unitId} />
        </div>
      </div>

      <div className={`${visible(1)} gap-4 sm:grid-cols-2`}>
        <div className="sm:col-span-2">{field("fullName", "Full name", { autoComplete: "name" })}</div>
        {field("phone", "Mobile number", { type: "tel", placeholder: "0712 345 678" })}
        {field("nationalId", "National ID")}
        {field("alternativePhone", "Alternative phone", { type: "tel" })}
        <p className="text-xs text-muted-foreground sm:col-span-2">If the phone number belongs to an existing tenant, their record is reused.</p>
      </div>

      <div className={`${visible(2)} gap-4 sm:grid-cols-3`}>
        {field("startDate", "Start date", { type: "date", defaultValue: today })}
        {field("rentAmount", "Monthly rent (KES)", { inputMode: "numeric", value: rent, onChange: (event) => setRent(event.target.value) })}
        {field("depositAmount", "Deposit (KES)", { inputMode: "numeric", value: deposit, onChange: (event) => setDeposit(event.target.value) })}
      </div>

      {unit?.meterNumber ? (
        <div className={`${visible(3)} gap-4`}>
          {field("openingReading", `Water meter ${unit.meterNumber}: reading today`, {
            inputMode: "numeric",
            value: opening,
            onChange: (event) => {
              setOpening(event.target.value.replace(/[^\d]/g, ""));
              setLocalError(undefined);
            },
          })}
        </div>
      ) : null}

      <div className={`${visible(4)} gap-4`}>
        {preview ? (
          <>
            {!preview.tenantIsNew ? <p className="rounded-md bg-brand-surface px-3 py-2 text-sm text-brand">This phone number belongs to an existing tenant; their record will be used.</p> : null}
            <div>
              <p className="mb-2 text-sm font-medium">First invoice</p>
              <ul className="divide-y rounded-lg border text-sm">
                {preview.lines.map((line) => (
                  <li key={line.description} className="flex justify-between gap-3 px-3 py-2">
                    <span>{line.description}</span>
                    <Money amount={line.amount} />
                  </li>
                ))}
                <li className="flex justify-between gap-3 bg-muted/50 px-3 py-2 font-semibold">
                  <span>Total</span>
                  <Money amount={preview.lines.reduce((sum, line) => sum + line.amount, 0)} />
                </li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">The tenant gets a welcome SMS with a pay link and this bill.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Calculating the first invoice…</p>
        )}
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
        {step < reviewStep - 1 ? (
          <Button key="next" type="button" onClick={() => setStep((value) => value + 1)}>
            Next
          </Button>
        ) : step === reviewStep - 1 ? (
          unit?.meterNumber && opening === "" ? (
            <Button key="review-blocked" type="button" onClick={() => setLocalError("Enter the meter reading on move-in day")}>
              Review
            </Button>
          ) : (
          <Button key="preview" type="button" onClick={runPreview} disabled={previewing}>
            {previewing ? <Loader2 className="animate-spin" /> : null} Review
          </Button>
          )
        ) : (
          <Button key="confirm" type="button" disabled={!preview || saving || previewing} onClick={() => setConfirming(true)}>
            {saving ? <Loader2 className="animate-spin" /> : null} Move in
          </Button>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this tenant in?</AlertDialogTitle>
            <AlertDialogDescription>The lease starts, the unit becomes occupied, the first invoice is posted and the tenant is texted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                if (formRef.current) submitSave(new FormData(formRef.current));
              }}
            >
              Move in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
