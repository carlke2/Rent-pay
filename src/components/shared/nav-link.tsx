"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/utilities/class-names";

/**
 * Next.js Link with an instant pending state while the destination RSC loads.
 * Makes tab/sidebar switches feel responsive even when the server is still working.
 */
export function NavLink({ className, children, pendingClassName, prefetch = false, ...props }: ComponentProps<typeof Link> & { pendingClassName?: string }) {
  // No prefetch by default: a sidebar would otherwise request every page in it as soon as it is on screen.
  return (
    <Link {...props} prefetch={prefetch} className={cn("relative", className)}>
      {children}
      <PendingOverlay className={pendingClassName} />
    </Link>
  );
}

function PendingOverlay({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden className={cn("pointer-events-none absolute inset-0 rounded-[inherit] bg-foreground/10", className)} />;
}
