"use client";

import { useRef, useState } from "react";
import { cn } from "@/utilities/class-names";

/**
 * Six digit boxes for an SMS code. Typing advances, Backspace goes back, pasting a full code fills all six.
 * The joined value is submitted as `name`.
 */
export function CodeInput({
  name = "code",
  length = 6,
  invalid = false,
  label = "Code",
  boxClassName,
}: {
  name?: string;
  length?: number;
  invalid?: boolean;
  label?: string;
  /** Extra classes for each digit box (merged over the defaults). */
  boxClassName?: string;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const fill = (start: number, text: string) => {
    const incoming = text.replace(/\D/g, "").slice(0, length - start).split("");
    if (incoming.length === 0) return;
    setDigits((current) => {
      const next = [...current];
      incoming.forEach((digit, offset) => (next[start + offset] = digit));
      return next;
    });
    boxes.current[Math.min(start + incoming.length, length - 1)]?.focus();
  };

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      <input type="hidden" name={name} value={digits.join("")} />
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          aria-label={`${label} digit ${index + 1}`}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={index === 0 ? length : 1}
          value={digit}
          autoFocus={index === 0}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, "");
            if (value.length > 1) return fill(index, value);
            setDigits((current) => current.map((item, position) => (position === index ? value : item)));
            if (value) boxes.current[index + 1]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index]) boxes.current[index - 1]?.focus();
            if (event.key === "ArrowLeft") boxes.current[index - 1]?.focus();
            if (event.key === "ArrowRight") boxes.current[index + 1]?.focus();
          }}
          onPaste={(event) => {
            event.preventDefault();
            fill(index, event.clipboardData.getData("text"));
          }}
          onFocus={(event) => event.target.select()}
          className={cn(
            "h-14 w-full min-w-0 max-w-14 rounded-[10px] border border-input bg-card text-center text-2xl font-semibold text-heading shadow-xs outline-none",
            "focus-visible:border-heading focus-visible:ring-[3px] focus-visible:ring-heading/15",
            boxClassName,
            invalid && "border-destructive",
          )}
        />
      ))}
    </div>
  );
}
