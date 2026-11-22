"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { loadAttentionAction } from "@/app/admin/actions/shell";
import type { AttentionItem } from "@/services/reports";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { cn } from "@/utilities/class-names";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/popover";
import { ATTENTION_ICONS } from "./attention-icons";
import { CommandSearch } from "./command-search";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];


const iconButton = "relative grid size-11 shrink-0 place-items-center rounded-lg border border-border-strong text-text-secondary hover:bg-surface-raised hover:text-heading";

export function AdminTopBar({
  title,
  currentPeriod,
  attention,
  menuButton,
}: {
  title: string;
  currentPeriod: string;
  attention: { items: AttentionItem[]; total: number };
  menuButton: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[calc(72px+env(safe-area-inset-top))] items-center gap-2 border-b border-sidebar-border bg-background pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:gap-3 sm:px-6 lg:px-8 print:hidden">
      {menuButton}
      <p className="hidden min-w-0 shrink truncate font-display text-2xl font-normal tracking-[-0.01em] text-heading sm:block">{title}</p>
      <div className="flex min-w-0 flex-1 justify-end md:justify-center md:px-4">
        <CommandSearch />
      </div>
      <MonthPicker currentPeriod={currentPeriod} />
      <HelpPopover />
      <ThemeToggle />
      <NotificationsPopover attention={attention} />
    </header>
  );
}

/** White "November 2026" button; choosing a month sets ?period=YYYY-MM on the current page. */
function MonthPicker({ currentPeriod }: { currentPeriod: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("period");
  const period = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentPeriod;
  const [year, month] = period.split("-").map(Number) as [number, number];
  const [currentYear, currentMonth] = currentPeriod.split("-").map(Number) as [number, number];
  const [open, setOpen] = useState(false);
  const [shownYear, setShownYear] = useState(year);

  function choose(chosenMonth: number) {
    const params = new URLSearchParams(searchParams.toString());
    const value = `${shownYear}-${String(chosenMonth).padStart(2, "0")}`;
    if (value === currentPeriod) params.delete("period");
    else params.set("period", value);
    setOpen(false);
    router.push(params.size ? `${pathname}?${params}` : pathname);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setShownYear(year);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          aria-label={`Month: ${LONG_MONTHS[month - 1]} ${year}. Change month`}
        >
          <CalendarDays className="hidden size-4 sm:block" aria-hidden />
          <span className="sm:hidden">
            {MONTHS[month - 1]} {year}
          </span>
          <span className="hidden sm:inline">
            {LONG_MONTHS[month - 1]} {year}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setShownYear((value) => value - 1)} className="grid size-11 place-items-center rounded-md hover:bg-accent" aria-label="Previous year">
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="numbers font-semibold">{shownYear}</span>
          <button
            type="button"
            onClick={() => setShownYear((value) => value + 1)}
            disabled={shownYear >= currentYear}
            className="grid size-11 place-items-center rounded-md hover:bg-accent disabled:opacity-40"
            aria-label="Next year"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS.map((label, index) => {
            const value = index + 1;
            const selected = shownYear === year && value === month;
            const future = shownYear > currentYear || (shownYear === currentYear && value > currentMonth);
            return (
              <button
                key={label}
                type="button"
                disabled={future}
                onClick={() => choose(value)}
                aria-pressed={selected}
                className={cn(
                  "h-11 rounded-md text-sm font-medium disabled:opacity-35",
                  selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HelpPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(iconButton, "hidden sm:grid")} aria-label="Help">
          <HelpCircle className="size-[18px]" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-semibold text-heading">Quick help</p>
        <ul className="mt-2 grid gap-2 text-text-secondary">
          <li>
            <kbd className="rounded border border-border-strong px-1.5 text-xs">⌘K</kbd> or <kbd className="rounded border border-border-strong px-1.5 text-xs">Ctrl K</kbd> searches tenants, units and M-Pesa receipts.
          </li>
          <li>Tenants pay to your Paybill with their unit code as the account number; those payments match by themselves.</li>
          <li>A payment with an unknown account lands in Payments → Unmatched for you to assign.</li>
          <li>The month button changes the month the overview shows.</li>
        </ul>
        <div className="mt-3 flex gap-3 text-sm">
          <Link href="/admin/settings/integrations">M-Pesa settings</Link>
          <Link href="/admin/settings/policies">Rent rules</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationsPopover({ attention }: { attention: { items: AttentionItem[]; total: number } }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(attention.items);
  const [total, setTotal] = useState(attention.total);
  const [loaded, setLoaded] = useState(attention.items.length > 0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || loaded) return;
    startTransition(async () => {
      const next = await loadAttentionAction();
      setItems(next.items);
      setTotal(next.total);
      setLoaded(true);
    });
  }, [open, loaded]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={iconButton} aria-label={total ? `Notifications: ${total} need attention` : "Notifications: nothing new"}>
          <Bell className="size-[18px]" aria-hidden />
          {total ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-[#ef4444] ring-2 ring-background" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold text-heading">Needs attention</p>
          {total ? <span className="numbers rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">{total}</span> : null}
        </div>
        {pending && !loaded ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">All clear. Nothing needs you right now.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {items.map((item) => {
              const { icon: Icon, tile } = ATTENTION_ICONS[item.kind];
              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-accent hover:text-foreground">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg ring-1", tile)}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.meta}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {total > items.length ? (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {total - items.length} more on the <Link href="/admin" onClick={() => setOpen(false)}>overview</Link>.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
