"use client";

import { LogOut, MoreVertical } from "lucide-react";
import { cn } from "@/utilities/class-names";
import { Avatar } from "./avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

/** Shell pieces shared by the landlord app and the tenant portal, so both sidebars look and behave the same. */

/** A sidebar link: 44px row, raised with an inset ring when active. `rail` centres the icon (collapsed sidebar). */
export const navItemClass = (active: boolean, rail = false) =>
  cn(
    "group flex h-11 items-center gap-3 rounded-lg text-sm font-medium no-underline transition-colors",
    rail ? "justify-center px-0" : "px-3",
    active ? "bg-surface-raised text-heading shadow-[inset_0_0_0_1px_var(--nav-active-ring)] hover:text-heading" : "text-text-secondary hover:bg-surface-raised/60 hover:text-heading",
  );

export function NavGroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{children}</p>;
}

/**
 * The signed-in user: a card at the foot of the sidebar ("card"), an avatar only in the collapsed rail ("rail")
 * or in the phone header ("compact"). Opens a menu with `children` items and Log out.
 */
export function UserMenu({
  name,
  detail,
  avatarSrc,
  variant = "card",
  signOut,
  children,
}: {
  name: string;
  detail: string;
  avatarSrc?: string | null;
  variant?: "card" | "rail" | "compact";
  signOut: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const card = variant === "card";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-xl text-left hover:bg-surface-raised",
            card ? "w-full border bg-card p-2.5" : variant === "rail" ? "w-full justify-center p-1.5" : "min-h-11 min-w-11 justify-center p-1",
          )}
          aria-label={`Account menu for ${name}`}
        >
          <Avatar name={name} src={avatarSrc} />
          {card ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <MoreVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={card ? "top" : variant === "rail" ? "right" : "bottom"} align={card ? "start" : "end"} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
        <DropdownMenuItem asChild>
          <form action={signOut} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
