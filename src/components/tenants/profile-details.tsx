"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { setWhatsappAction } from "@/app/tenants/actions/profile";
import { signOutTenant } from "@/app/tenants/actions/session";
import { useServerForm } from "@/components/shared/use-server-form";
import { cn } from "@/utilities/class-names";
import { PhoneChangeForm } from "./phone-change-form";

const local = (phone: string | null) => (phone ? `0${phone.slice(3)}` : "Not set");

const EDIT_EVENT = "profile:edit-details";

/**
 * "Edit details" on the profile card: opens the phone-number form in the contact card below/beside it and puts
 * the cursor in it (a plain #anchor did nothing visible on desktop, where the card is already on screen).
 */
export function EditDetailsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(EDIT_EVENT))}
      className="relative mb-1 inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong bg-card px-3.5 text-sm font-medium text-foreground after:absolute after:-inset-1 hover:bg-surface-raised"
    >
      <PencilLine className="size-3.5" aria-hidden /> Edit details
    </button>
  );
}

/** One card of 56px rows: phone numbers (verified change flow), the WhatsApp switch, and Log out. */
export function ProfileDetails({ phone, alternativePhone, whatsappOptIn }: { phone: string; alternativePhone: string | null; whatsappOptIn: boolean }) {
  const [editing, setEditing] = useState<"phone" | "alternativePhone" | null>(null);
  const whatsapp = useServerForm(setWhatsappAction);
  const [optIn, setOptIn] = useState(whatsappOptIn);
  const seen = useRef(0);
  const card = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    const open = () => {
      setEditing("phone");
      setFocusRequest(Date.now());
    };
    window.addEventListener(EDIT_EVENT, open);
    return () => window.removeEventListener(EDIT_EVENT, open);
  }, []);
  useEffect(() => {
    if (!focusRequest) return;
    const input = card.current?.querySelector<HTMLInputElement>("#new-phone");
    input?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    input?.focus({ preventScroll: true });
  }, [focusRequest, editing]);
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

  const row = "flex min-h-14 items-center justify-between gap-3 px-4 py-2";
  return (
    <div ref={card} className="divide-y overflow-hidden rounded-[14px] border bg-card">
      {([
        ["phone", "Phone number", phone],
        ["alternativePhone", "Alternative number", alternativePhone],
      ] as const).map(([field, label, value]) => (
        <div key={field}>
          <div className={row}>
            <div className="min-w-0">
              <p className="text-[13px] leading-tight text-muted-foreground">{label}</p>
              <p className="numbers truncate text-[15px] leading-snug font-medium text-heading">{local(value)}</p>
            </div>
            <button type="button" className="-mr-2 min-h-11 shrink-0 px-2 text-sm font-medium text-link" onClick={() => setEditing(editing === field ? null : field)} aria-expanded={editing === field}>
              {editing === field ? "Cancel" : value ? "Change" : "Add"}
            </button>
          </div>
          {editing === field ? (
            <div className="border-t px-4 py-3">
              <PhoneChangeForm field={field} label={label} onDone={() => setEditing(null)} />
            </div>
          ) : null}
        </div>
      ))}

      <div className={row}>
        <div className="min-w-0">
          <p id="whatsapp-label" className="text-[13px] leading-tight text-muted-foreground">WhatsApp messages</p>
          <p className="text-[15px] leading-snug font-medium text-heading">{optIn ? "On" : "Off"}<span className="font-normal text-muted-foreground"> · bills and receipts</span></p>
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
          className="-mr-1 grid h-11 w-14 shrink-0 place-items-center"
        >
          <span className={cn("relative block h-7 w-12 rounded-full transition-colors", optIn ? "bg-primary" : "bg-border-strong")}>
            <span className={cn("absolute top-1 left-1 size-5 rounded-full shadow transition-transform", optIn ? "translate-x-5 bg-primary-foreground" : "bg-white")} />
          </span>
        </button>
      </div>

      <form action={signOutTenant}>
        <button type="submit" className={cn(row, "w-full text-[15px] font-medium text-destructive hover:bg-surface-raised/50")}>
          <span className="flex items-center gap-2">
            <LogOut className="size-4" aria-hidden /> Log out
          </span>
        </button>
      </form>
    </div>
  );
}
