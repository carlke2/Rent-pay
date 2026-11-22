import Link from "next/link";

/**
 * Friendly page for an unknown or expired public link (bill card, receipt). Rendered by not-found.tsx, so the
 * response is a real HTTP 404. Always light: these pages sit outside the apps.
 */
export function ExpiredLinkCard({ title, message, action }: { title: string; message: string; action: { href: string; label: string } }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-[#F5F5F4] px-[max(1rem,env(safe-area-inset-left))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] font-sans text-[#171717] sm:items-center">
      <article className="w-full max-w-[360px] overflow-hidden rounded-[18px] border border-[#E7E5E4] bg-white px-[22px] py-7 text-center">
        <span className="mx-auto mb-4 grid size-8 place-items-center rounded-full bg-white ring-1 ring-[#E7E5E4]" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[60%]">
            <path d="M3.5 10.5 12 4l8.5 6.5" />
            <path d="M5.5 9v10.5h13V9" />
            <path d="m9 14.2 2.2 2.2 4-4.4" />
          </svg>
        </span>
        <h1 className="font-display text-[24px] leading-tight text-[#171717]">{title}</h1>
        <p className="mt-2 text-sm text-[#6B6B72]">{message}</p>
        <Link
          href={action.href}
          className="mt-5 flex h-[46px] w-full items-center justify-center rounded-xl bg-[#111111] text-[15px] font-semibold text-white no-underline hover:text-white"
        >
          {action.label}
        </Link>
      </article>
    </main>
  );
}
