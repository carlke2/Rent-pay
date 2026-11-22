"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setWhatsappAction } from "@/app/tenants/actions/profile";
import { useServerForm } from "@/components/shared/use-server-form";
import { cn } from "@/utilities/class-names";
import { PhoneChangeForm } from "./phone-change-form";

const local = (phone: string | null) => (phone ? `0${phone.slice(3)}` : "Not set");

/** Phone numbers with a verified change flow, and the WhatsApp switch. */
export function ProfileDetails({ phone, alternativePhone, whatsappOptIn }: { phone: string; alternativePhone: string | null; whatsappOptIn: boolean }) {
  const [editing, setEditing] = useState<"phone" | "alternativePhone" | null>(null);
  const whatsapp = useServerForm(setWhatsappAction);
  const [optIn, setOptIn] = useState(whatsappOptIn);
  const seen = useRef(0);
  useEffect(() => {
    const state = whatsapp.state;
    if (!state.at || state.at === seen.current) return;
    seen.current = state.at;
    if (state.status === "success" && state.message) toast.success(state.message);
    if (state.status === "error") {
      toast.error(state.message ?? "Couldn't save that");
      setOptIn((value) => !value);
    }
  }, [whatsapp.state]);

  return (
    <div className="grid gap-3">
      {([
        ["phone", "Phone number", phone],
        ["alternativePhone", "Alternative number", alternativePhone],
      ] as const).map(([field, label, value]) => (
        <section key={field} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold text-heading">{local(value)}</p>
            </div>
            <button type="button" className="min-h-11 px-2 text-sm font-medium text-link" onClick={() => setEditing(editing === field ? null : field)} aria-expanded={editing === field}>
              {editing === field ? "Cancel" : value ? "Change" : "Add"}
            </button>
          </div>
          {editing === field ? (
            <div className="mt-3 border-t border-border pt-3">
              <PhoneChangeForm field={field} label={label} onDone={() => setEditing(null)} />
            </div>
          ) : null}
        </section>
      ))}

      <section className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <p id="whatsapp-label" className="font-medium text-heading">WhatsApp messages</p>
          <p className="text-sm text-muted-foreground">Get bills and receipts on WhatsApp too.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          aria-labelledby="whatsapp-label"
          disabled={whatsapp.pending}
          onClick={() => {
            const next = !optIn;
            setOptIn(next);
            const data = new FormData();
            data.set("optIn", String(next));
            whatsapp.submit(data);
          }}
          className="grid h-11 w-16 shrink-0 place-items-center"
        >
          <span className={cn("relative block h-8 w-14 rounded-full transition-colors", optIn ? "bg-primary" : "bg-border-strong")}>
            <span className={cn("absolute top-1 left-1 size-6 rounded-full shadow transition-transform", optIn ? "translate-x-6 bg-primary-foreground" : "bg-white")} />
          </span>
        </button>
      </section>
    </div>
  );
}
