"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Building2, Loader2, Receipt, Search, User } from "lucide-react";
import { searchAction } from "@/app/admin/actions/shell";
import type { SearchResult } from "@/services/search";
import { cn } from "@/utilities/class-names";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../shared/ui/dialog";

const KIND_LABELS: Record<SearchResult["kind"], string> = { tenant: "Tenants", unit: "Units", payment: "Payments" };
const KIND_ICONS = { tenant: User, unit: Building2, payment: Receipt } as const;

/** Search box in the top bar; ⌘K / Ctrl+K opens a dialog that searches tenants, units and payments and jumps to the result. */
export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const latest = useRef("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const query = text.trim();
    latest.current = query;
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const found = await searchAction(query);
        if (latest.current === query) {
          setResults(found);
          setActiveIndex(0);
        }
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [text]);

  function go(result: SearchResult | undefined) {
    if (!result) return;
    setOpen(false);
    setText("");
    setResults([]);
    router.push(result.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[activeIndex]);
    }
  }

  const kinds = (["tenant", "unit", "payment"] as const).filter((kind) => results.some((result) => result.kind === kind));
  const activeId = results[activeIndex] ? `search-result-${activeIndex}` : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-11 w-full max-w-md items-center gap-2.5 rounded-lg border border-input bg-input-background px-3 text-sm text-placeholder hover:border-border-strong md:flex"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">Search tenants, units, M-Pesa receipts</span>
        <kbd className="rounded border border-border-strong px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 place-items-center rounded-lg border border-border-strong text-text-secondary hover:bg-surface-raised hover:text-heading md:hidden"
        aria-label="Search tenants, units, M-Pesa receipts"
      >
        <Search className="size-[18px]" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[max(1rem,env(safe-area-inset-top))] gap-0 overflow-hidden p-0 sm:top-[12%] sm:max-w-xl sm:translate-y-0" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search tenants by name or phone, units by code and payments by M-Pesa receipt or receipt number.</DialogDescription>
          <div className="flex items-center gap-2.5 border-b px-4">
            {pending ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <input
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search tenants, units, M-Pesa receipts"
              className="h-14 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-placeholder focus-visible:!shadow-none focus-visible:!outline-none"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="search-results"
              aria-activedescendant={activeId}
              aria-label="Search"
            />
            <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-muted-foreground">Esc</kbd>
          </div>
          <div id="search-results" role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
            {text.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type a name, phone, unit code or M-Pesa receipt.</p>
            ) : results.length === 0 && !pending ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{text.trim()}”.</p>
            ) : (
              kinds.map((kind) => (
                <div key={kind} className="mb-1">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{KIND_LABELS[kind]}</p>
                  {results.map((result, index) => {
                    if (result.kind !== kind) return null;
                    const Icon = KIND_ICONS[kind];
                    return (
                      <div
                        key={`${result.kind}-${result.id}`}
                        id={`search-result-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(result)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", index === activeIndex && "bg-surface-raised")}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-heading">{result.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{result.detail}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
