"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/utilities/class-names";

/** Copies a value (e.g. the Paybill number) with a 44px tap target. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(`${label} copied`);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Couldn't copy; please type it in");
        }
      }}
      aria-label={`Copy ${label.toLowerCase()} ${value}`}
      className={cn("inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-sm font-medium text-text-secondary hover:bg-surface-muted", className)}
    >
      {copied ? <Check className="size-4 text-status-paid" /> : <Copy className="size-4" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
