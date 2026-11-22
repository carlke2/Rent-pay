"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

/** Used by every error.tsx: explains what happened and offers a retry. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-status-overdue/25 bg-status-overdue-surface px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-8 text-status-overdue" aria-hidden />
      <p className="font-medium">This page couldn&apos;t load.</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        It may be a brief connection problem. If it keeps happening, check the server logs{error.digest ? ` (ref ${error.digest})` : ""}.
      </p>
      <Button className="mt-4" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
