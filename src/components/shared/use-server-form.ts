"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import { IDLE, type ActionState } from "./action-types";

/**
 * Runs a Server Action from a form without React's automatic form reset (which would wipe what was typed
 * whenever the server returns a validation error). Forms reset themselves on success where that's wanted.
 */
export function useServerForm(action: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, dispatch, actionPending] = useActionState(action, IDLE);
  const [transitionPending, startTransition] = useTransition();
  const submit = (formData: FormData) => startTransition(() => dispatch(formData));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    submit(new FormData(event.currentTarget, submitter));
  };
  return { state, pending: actionPending || transitionPending, submit, onSubmit };
}
