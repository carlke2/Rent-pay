"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/utilities/class-names";
import { selectClassName, type ActionState, type FormFieldConfig } from "./action-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { useServerForm } from "./use-server-form";

type ButtonVariant = "default" | "outline" | "secondary" | "destructive" | "ghost" | "link";

export type ActionFormProps = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields?: FormFieldConfig[];
  submitLabel: string;
  submitVariant?: ButtonVariant;
  /** Ask before submitting (money and destructive actions). */
  confirm?: { title: string; description: string; confirmLabel?: string; destructive?: boolean };
  /** Render the form in a dialog opened by a button. */
  dialog?: { trigger: string; title: string; description?: string; triggerVariant?: ButtonVariant; triggerSize?: "sm" | "default"; triggerClassName?: string; defaultOpen?: boolean };
  /** Show the action's returned data as a summary under the form. */
  showResult?: boolean;
  /** Lay fields and button out in one row (filters, small actions). */
  inline?: boolean;
  className?: string;
};


function SubmitButton({ label, variant, onClick, pending }: { label: string; variant?: ButtonVariant; onClick?: () => void; pending: boolean }) {
  return (
    <Button type={onClick ? "button" : "submit"} variant={variant} disabled={pending} onClick={onClick} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

export function Field({ field, error, formId }: { field: FormFieldConfig; error?: string; formId: string }) {
  const id = `${formId}-${field.name}`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const common = {
    id,
    name: field.name,
    required: field.required,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
  };
  if (field.type === "hidden") return <input type="hidden" name={field.name} value={String(field.defaultValue ?? "")} />;

  let control: React.ReactNode;
  if (field.type === "textarea") {
    control = <Textarea {...common} defaultValue={field.defaultValue == null ? undefined : String(field.defaultValue)} placeholder={field.placeholder} rows={3} />;
  } else if (field.type === "select") {
    control = (
      <select {...common} defaultValue={field.defaultValue == null ? "" : String(field.defaultValue)} className={selectClassName}>
        {field.placeholder ? (
          <option value="" disabled>
            {field.placeholder}
          </option>
        ) : null}
        {field.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "checkbox") {
    return (
      <div className={cn("flex items-start gap-2", field.span !== "half" && "sm:col-span-2")}>
        <input {...common} type="checkbox" value="true" defaultChecked={Boolean(field.defaultValue)} className="mt-0.5 size-4 accent-[var(--brand)]" />
        <div className="grid gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
          <FieldError id={errorId} message={error} />
        </div>
      </div>
    );
  } else {
    control = (
      <Input
        {...common}
        type={field.type ?? "text"}
        accept={field.accept}
        inputMode={field.type === "number" ? "numeric" : undefined}
        defaultValue={field.type === "file" || field.defaultValue == null ? undefined : String(field.defaultValue)}
        placeholder={field.placeholder}
      />
    );
  }

  return (
    <div className={cn("grid gap-1.5", field.span !== "half" && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {field.label}
        {field.required ? <span className="text-destructive" aria-hidden> *</span> : null}
      </Label>
      {control}
      {field.hint && !error ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function ResultSummary({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);
  return (
    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</dt>
          <dd className="min-w-0 break-words">
            {Array.isArray(value)
              ? value.length === 0
                ? "None"
                : value.map((item) => (typeof item === "object" ? Object.values(item as object).join(": ") : String(item))).join(" · ")
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Any form backed by a Server Action: field errors next to fields, pending state, toast on result. */
export function ActionForm(props: ActionFormProps) {
  const [open, setOpen] = useState(Boolean(props.dialog?.defaultOpen));
  const [generation, setGeneration] = useState(0);
  const body = (
    <FormBody
      key={generation}
      {...props}
      onSuccess={() => {
        if (props.dialog) {
          setOpen(false);
          setGeneration((value) => value + 1);
        }
      }}
    />
  );
  if (!props.dialog) return body;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={props.dialog.triggerVariant ?? "outline"} size={props.dialog.triggerSize ?? "sm"} className={props.dialog.triggerClassName}>
          {props.dialog.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.dialog.title}</DialogTitle>
          {props.dialog.description ? <DialogDescription>{props.dialog.description}</DialogDescription> : null}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({ action, fields = [], submitLabel, submitVariant, confirm, showResult, inline, className, onSuccess }: ActionFormProps & { onSuccess: () => void }) {
  const { state, pending, onSubmit } = useServerForm(action);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useRef(`form-${Math.random().toString(36).slice(2, 8)}`).current;
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    if (state.status === "success") {
      if (state.message) toast.success(state.message);
      if (!showResult) {
        formRef.current?.reset();
        onSuccess();
      }
    } else if (state.status === "error" && state.message) {
      toast.error(state.message);
    }
  }, [state, showResult, onSuccess]);

  return (
    <>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className={cn(inline ? "flex flex-wrap items-end gap-2" : "grid gap-4 sm:grid-cols-2", className)}
      >
        {state.status === "error" && state.message && !inline ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-status-overdue-surface px-3 py-2 text-sm text-destructive sm:col-span-2">
            {state.message}
          </p>
        ) : null}
        {fields.map((field) => (
          <Field key={field.name} field={field} error={state.fieldErrors?.[field.name]} formId={formId} />
        ))}
        <div className={cn("flex justify-end gap-2", !inline && "sm:col-span-2")}>
          <SubmitButton label={submitLabel} variant={submitVariant ?? (confirm?.destructive ? "destructive" : "default")} onClick={confirm ? () => setConfirming(true) : undefined} pending={pending} />
        </div>
      </form>

      {confirm ? (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={cn(confirm.destructive && "bg-destructive text-white hover:bg-destructive/90")}
                onClick={() => {
                  setConfirming(false);
                  formRef.current?.requestSubmit();
                }}
              >
                {confirm.confirmLabel ?? submitLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {showResult && state.status === "success" && state.data ? <ResultSummary data={state.data} /> : null}
    </>
  );
}
