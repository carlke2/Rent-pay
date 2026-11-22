import { Check } from "lucide-react";
import { cn } from "@/utilities/class-names";

/** Step indicator for the move-in and move-out wizards. */
export function WizardSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex gap-1 overflow-x-auto pb-1" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} className="flex min-w-fit flex-1 items-center gap-2" aria-current={index === current ? "step" : undefined}>
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
              index < current && "border-brand bg-brand text-brand-foreground",
              index === current && "border-brand text-brand",
              index > current && "text-muted-foreground",
            )}
          >
            {index < current ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span className={cn("text-xs whitespace-nowrap", index === current ? "font-medium" : "text-muted-foreground", index !== current && "hidden sm:inline")}>{step}</span>
          {index < steps.length - 1 ? <span className="hidden h-px flex-1 bg-border sm:block" /> : null}
        </li>
      ))}
    </ol>
  );
}
