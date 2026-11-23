import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function TenantHeading({ title, description, back }: { title: string; description?: React.ReactNode; back?: string }) {
  return (
    <div className="mb-5">
      {back ? (
        <Link prefetch={false} href={back} className="-ml-2 mb-2 inline-grid size-11 place-items-center rounded-full text-heading no-underline hover:bg-surface-muted print:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
      ) : null}
      <h1 className="font-display text-[26px] leading-tight font-normal tracking-[-0.01em]">{title}</h1>
      {description ? <p className="mt-1 text-text-secondary">{description}</p> : null}
    </div>
  );
}

export function TenantCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-4 ${className ?? ""}`}>{children}</section>;
}
