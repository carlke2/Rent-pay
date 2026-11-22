"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { reportPaymentAction } from "@/app/tenants/actions/payments";
import { selectClassName } from "@/components/shared/action-types";
import { FieldError } from "@/components/shared/action-form";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import { useServerForm } from "@/components/shared/use-server-form";

const MAX_BYTES = 5 * 1024 * 1024;

/** Amount, date, method, reference and an optional slip photo (camera or file, image only, up to 5 MB). */
export function ReportPaymentForm({ today }: { today: string }) {
  const { state, pending, onSubmit } = useServerForm(reportPaymentAction);
  const formRef = useRef<HTMLFormElement>(null);
  const [slipName, setSlipName] = useState<string | null>(null);
  const [slipError, setSlipError] = useState<string | undefined>(undefined);
  const seen = useRef(0);
  useEffect(() => {
    if (!state.at || state.at === seen.current) return;
    seen.current = state.at;
    if (state.status === "success") {
      toast.success(state.message ?? "Sent");
      formRef.current?.reset();
      setSlipName(null);
    } else if (state.message && !state.fieldErrors) toast.error(state.message);
  }, [state]);
  const error = (name: string) => (name === "slip" ? (slipError ?? state.fieldErrors?.slip) : state.fieldErrors?.[name]);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        if (slipError) {
          event.preventDefault();
          return;
        }
        onSubmit(event);
      }}
      className="grid gap-4"
      noValidate
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="claim-amount" className="text-text-secondary">Amount (KES)</Label>
          <Input id="claim-amount" name="amount" inputMode="numeric" aria-invalid={Boolean(error("amount")) || undefined} />
          <FieldError id="claim-amount-error" message={error("amount")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="claim-date" className="text-text-secondary">Date paid</Label>
          <Input id="claim-date" name="paidOn" type="date" defaultValue={today} max={today} aria-invalid={Boolean(error("paidOn")) || undefined} />
          <FieldError id="claim-date-error" message={error("paidOn")} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="claim-method" className="text-text-secondary">How you paid</Label>
        <select id="claim-method" name="method" defaultValue="bank" className={selectClassName}>
          <option value="bank">Bank deposit or transfer</option>
          <option value="cash">Cash to the landlord or caretaker</option>
        </select>
        <FieldError id="claim-method-error" message={error("method")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="claim-reference" className="text-text-secondary">Reference (optional)</Label>
        <Input id="claim-reference" name="reference" placeholder="Bank slip or receipt number" aria-invalid={Boolean(error("reference")) || undefined} />
        <FieldError id="claim-reference-error" message={error("reference")} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-text-secondary">Slip photo (optional)</span>
        <label htmlFor="claim-slip" className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-border bg-input-addon px-4 text-sm text-text-secondary hover:bg-surface-muted">
          <Camera className="size-5 text-heading" aria-hidden />
          <span className="truncate">{slipName ?? "Take a photo or choose one"}</span>
        </label>
        <input
          id="claim-slip"
          name="slip"
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setSlipName(file?.name ?? null);
            setSlipError(file && !file.type.startsWith("image/") ? "The slip must be a photo" : file && file.size > MAX_BYTES ? "The photo must be 5 MB or smaller" : undefined);
          }}
        />
        <FieldError id="claim-slip-error" message={error("slip")} />
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" /> : null} Send to landlord
      </Button>
    </form>
  );
}
