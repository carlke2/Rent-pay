"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmPhoneChangeAction, requestPhoneChangeAction } from "@/app/tenants/actions/profile";
import { FieldError } from "@/components/shared/action-form";
import { CodeInput } from "@/components/shared/code-input";
import { ResendCountdown } from "@/components/shared/resend-countdown";
import { Button } from "@/components/shared/ui/button";
import { Input } from "@/components/shared/ui/input";
import { Label } from "@/components/shared/ui/label";
import { useServerForm } from "@/components/shared/use-server-form";

/** Change a phone number: enter the new number, then the code we text to it. */
export function PhoneChangeForm({ field, label, onDone }: { field: "phone" | "alternativePhone"; label: string; onDone: () => void }) {
  const request = useServerForm(requestPhoneChangeAction);
  const confirm = useServerForm(confirmPhoneChangeAction);
  const [sent, setSent] = useState<{ phone: string; sentAt: number } | null>(null);
  const seen = useRef(0);

  useEffect(() => {
    for (const state of [request.state, confirm.state]) {
      if (!state.at || state.at <= seen.current) continue;
      seen.current = state.at;
      if (state.status === "error" && state.message && !state.fieldErrors) toast.error(state.message);
      if (state.status === "success" && state === request.state && state.data) {
        setSent({ phone: String(state.data.phone), sentAt: Number(state.data.sentAt) });
      }
      if (state.status === "success" && state === confirm.state) {
        toast.success(state.message ?? "Updated");
        onDone();
      }
    }
  }, [request.state, confirm.state, onDone]);

  if (sent) {
    return (
      <form onSubmit={confirm.onSubmit} className="grid gap-4" noValidate>
        <input type="hidden" name="field" value={field} />
        <input type="hidden" name="newPhone" value={sent.phone} />
        <p className="text-sm text-text-secondary">Enter the 6-digit code we sent to 0{sent.phone.slice(3, 6)} ••• {sent.phone.slice(-3)}.</p>
        {confirm.state.status === "error" && confirm.state.message && !confirm.state.fieldErrors ? (
          <p role="alert" className="text-sm text-destructive">{confirm.state.message}</p>
        ) : null}
        <CodeInput label="Confirmation code" invalid={confirm.state.status === "error"} />
        <FieldError id="phone-code-error" message={confirm.state.fieldErrors?.code} />
        <Button type="submit" disabled={confirm.pending} className="w-full">
          {confirm.pending ? <Loader2 className="animate-spin" /> : null} Confirm new number
        </Button>
        <div className="flex items-center justify-between">
          <button type="button" className="min-h-11 text-sm font-medium text-link" onClick={() => setSent(null)}>
            Use a different number
          </button>
          <ResendButton field={field} phone={sent.phone} sentAt={sent.sentAt} onSent={(sentAt) => setSent({ ...sent, sentAt })} />
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={request.onSubmit} className="grid gap-3" noValidate>
      <input type="hidden" name="field" value={field} />
      <div className="grid gap-1.5">
        <Label htmlFor={`new-${field}`} className="text-text-secondary">New {label.toLowerCase()}</Label>
        <Input id={`new-${field}`} name="newPhone" type="tel" inputMode="tel" placeholder="0712 345 678" aria-invalid={Boolean(request.state.fieldErrors?.newPhone) || undefined} />
        <FieldError id={`new-${field}-error`} message={request.state.fieldErrors?.newPhone} />
        {request.state.status === "error" && request.state.message && !request.state.fieldErrors ? <p role="alert" className="text-sm text-destructive">{request.state.message}</p> : null}
      </div>
      <Button type="submit" disabled={request.pending} className="w-full">
        {request.pending ? <Loader2 className="animate-spin" /> : null} Text me a code
      </Button>
    </form>
  );
}

function ResendButton({ field, phone, sentAt, onSent }: { field: string; phone: string; sentAt: number; onSent: (sentAt: number) => void }) {
  const resend = useServerForm(requestPhoneChangeAction);
  useEffect(() => {
    if (resend.state.status === "success" && resend.state.data) onSent(Number(resend.state.data.sentAt));
    if (resend.state.status === "error" && resend.state.message) toast.error(resend.state.message);
  }, [resend.state]);
  return (
    <ResendCountdown
      startedAt={sentAt}
      onResend={() => {
        const data = new FormData();
        data.set("field", field);
        data.set("newPhone", phone);
        resend.submit(data);
      }}
    />
  );
}
