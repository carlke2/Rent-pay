"use client";

import { useEffect, useState } from "react";

/**
 * "Resend code in 0:42", then a "Resend code" button: a submit button with name="intent" value="resend"
 * (or the given intent), or a plain button calling `onResend` when one is passed.
 */
export function ResendCountdown({
  seconds = 60,
  startedAt,
  intent = "resend",
  onResend,
  className: extraClassName,
  waitingClassName,
  waitingLabel = "Resend code in",
}: {
  seconds?: number;
  startedAt: number;
  intent?: string;
  onResend?: () => void;
  className?: string;
  waitingClassName?: string;
  waitingLabel?: string;
}) {
  const remainingAt = () => Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000));
  const [remaining, setRemaining] = useState(remainingAt);
  useEffect(() => {
    setRemaining(remainingAt());
    const timer = setInterval(() => setRemaining(remainingAt()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (remaining > 0) {
    return (
      <p className={waitingClassName ?? "text-sm text-muted-foreground"} aria-live="polite">
        {waitingLabel} {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </p>
    );
  }
  const className = extraClassName ?? "min-h-11 text-sm font-medium text-link hover:text-link-hover";
  if (onResend) {
    return (
      <button type="button" onClick={onResend} className={className}>
        Resend code
      </button>
    );
  }
  return (
    <button type="submit" name="intent" value={intent} formNoValidate className={className}>
      Resend code
    </button>
  );
}
