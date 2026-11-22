"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/utilities/class-names";

export function initialsOf(name: string, fallback = "?") {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || fallback
  );
}

/**
 * A round person avatar: their photo (served privately by /api/avatars/[tenantId]) or their initials.
 * Falls back to the initials if the photo can't be loaded (missing file, storage hiccup), never a broken image.
 * Size comes from className (default size-9). Decorative by default, since the name is always shown beside it.
 */
export function Avatar({ name, src, className, alt = "" }: { name: string; src?: string | null; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A server-rendered <img> can fail before React attaches onError: check once on mount / src change.
    const element = image.current;
    setFailed(Boolean(element && element.complete && element.naturalWidth === 0));
  }, [src]);
  const showPhoto = Boolean(src) && !failed;
  return (
    <span className={cn("relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-raised text-sm font-semibold text-heading ring-1 ring-border-strong", className)} aria-hidden={alt && showPhoto ? undefined : true}>
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- private, cookie-authenticated image; next/image's optimizer can't fetch it
        <img ref={image} src={src!} alt={alt} className="size-full object-cover" decoding="async" onError={() => setFailed(true)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
