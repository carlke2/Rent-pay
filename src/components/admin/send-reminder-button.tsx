"use client";

import { useEffect, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendReminderAction } from "@/app/admin/actions/payments";
import { Button } from "@/components/shared/ui/button";
import { useServerForm } from "@/components/shared/use-server-form";
import { cn } from "@/utilities/class-names";

/**
 * "Send reminder": texts the tenant the reminder SMS with their bill link. Once per lease per day, so after
 * it's used (here or earlier today) it shows "Reminder sent today" instead.
 */
export function SendReminderButton({
  leaseId,
  sentToday,
  label,
  size = "sm",
  variant = "outline",
  className,
}: {
  leaseId: string;
  sentToday: boolean;
  /** For screen readers, e.g. "Send reminder to A1". */
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  className?: string;
}) {
  const { state, pending, onSubmit } = useServerForm(sendReminderAction);
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    if (state.status === "success" && state.message) toast.success(state.message);
    else if (state.status === "error" && state.message) toast.error(state.message);
  }, [state]);

  const done = sentToday || state.status === "success" || state.message === "Reminder sent today";
  if (done) {
    return (
      <Button type="button" size={size} variant="outline" disabled className={cn("text-muted-foreground", className)}>
        <Check aria-hidden />
        Reminder sent today
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="contents">
      <input type="hidden" name="leaseId" value={leaseId} />
      <Button type="submit" size={size} variant={variant} disabled={pending} aria-busy={pending} aria-label={label} className={className}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Send reminder
      </Button>
    </form>
  );
}
