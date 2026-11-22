/** What every form's Server Action returns (shared by server actions and client forms). */
export type ActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  /** One message per field name (dotted for nested fields, e.g. "penalty.amount"). */
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
  /** Changes on every response so repeated identical results still trigger toasts. */
  at?: number;
};

export const IDLE: ActionState = { status: "idle" };

export type FieldOption = { value: string; label: string };

export type FormFieldConfig = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "email" | "tel" | "password" | "textarea" | "select" | "hidden" | "file" | "checkbox";
  options?: FieldOption[];
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  accept?: string;
  /** "half" fields sit two per row on wider screens. */
  span?: "full" | "half";
};

/** Native <select> styled like the shadcn inputs (works with FormData and GET filters). */
export const selectClassName =
  "h-12 w-full rounded-[10px] border border-input bg-input-background px-3.5 text-base shadow-xs outline-none focus-visible:border-heading focus-visible:ring-[3px] focus-visible:ring-heading/15 aria-invalid:border-destructive";
