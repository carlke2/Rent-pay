import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEnvironment } from "@/configuration/environment";
import { getBillCard, type BillCardType } from "@/services/bill-card";
import { formatAmount } from "@/utilities/money";

export const dynamic = "force-dynamic";
/** Generic on purpose: link previews must never show amounts, names, unit codes or phone numbers. */
export async function generateMetadata(): Promise<Metadata> {
  const appName = getEnvironment().APP_NAME;
  const title = `Your bill · ${appName}`;
  const description = "Rent payments and receipts";
  const images = [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: appName }];
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    openGraph: { type: "website", siteName: appName, title, description, images },
    twitter: { card: "summary", title, description, images: ["/icons/icon-512.png"] },
  };
}

const THEMES: Record<BillCardType, { band: string; accent: string; button: string }> = {
  bill: { band: "#111111", accent: "#C49A45", button: "#111111" },
  reminder: { band: "#1E3A5F", accent: "#7DA7D9", button: "#1E3A5F" },
  overdue: { band: "#7F1D1D", accent: "#F87171", button: "#7F1D1D" },
  paid: { band: "#14532D", accent: "#4ADE80", button: "#14532D" },
};

function HouseCheck({ color }: { color: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="size-[60%]">
        <path d="M3.5 10.5 12 4l8.5 6.5" />
        <path d="M5.5 9v10.5h13V9" />
        <path d="m9 14.2 2.2 2.2 4-4.4" />
      </svg>
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-[#F5F5F4] px-[max(1rem,env(safe-area-inset-left))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] font-sans text-[#171717] sm:items-center">
      {children}
    </main>
  );
}

/** Public message card opened from SMS links: the lease's current bill, reminder, overdue notice or payment. */
export default async function BillCardPage({ params }: PageProps<"/bill/[code]">) {
  const { code } = await params;
  const appName = getEnvironment().APP_NAME;
  const card = await getBillCard(code);

  // Unknown or expired: not-found.tsx renders the friendly card with an HTTP 404.
  if (!card) notFound();

  const theme = THEMES[card.type];
  const buttonClass = "flex h-[46px] w-full items-center justify-center rounded-xl text-[15px] font-semibold text-white no-underline";

  return (
    <Shell>
      <article className="w-full max-w-[360px] overflow-hidden rounded-[18px] border border-[#E7E5E4] bg-white">
        <header className="px-[22px] py-5 text-white" style={{ backgroundColor: theme.band }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <HouseCheck color={theme.band} />
              <span className="truncate font-display text-[18px] italic leading-none">{appName}</span>
            </div>
            <span className="shrink-0 rounded-full bg-white/[0.16] px-2.5 py-1 text-[11px] font-semibold tracking-wide">{card.pill}</span>
          </div>
          <h1 className="mt-5 font-display text-[26px] leading-tight font-normal text-white">{card.title}</h1>
          <p className="numbers mt-1 font-sans text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
            <span className="mr-1.5 text-[18px] font-medium">KES</span>
            {formatAmount(card.amount)}
          </p>
          <p className="mt-2.5 text-[13px] opacity-85">{card.detail}</p>
        </header>
        <div className="h-[3px]" style={{ backgroundColor: theme.accent }} aria-hidden />

        <div className="px-[22px] pt-2 pb-5">
          {card.rows.length > 0 ? (
            <dl className="divide-y divide-[#F0EEEC]">
              {card.rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                  <dt className="min-w-0 text-[#6B6B72]">{row.label}</dt>
                  <dd className="numbers shrink-0 text-right font-semibold tabular-nums text-[#171717]">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {card.action?.kind === "pay" ? (
            // POST, not a link: messaging apps fetch links for previews, and that must never sign anyone in.
            <form method="post" action={`/bill/${code}/pay`} className="mt-4">
              <input type="hidden" name="amount" value={card.action.payAmount} />
              <button type="submit" className={`${buttonClass} cursor-pointer`} style={{ backgroundColor: theme.button }}>
                {card.action.label}
              </button>
            </form>
          ) : card.action?.kind === "link" ? (
            <Link href={card.action.href} className={`${buttonClass} mt-4`} style={{ backgroundColor: theme.button }}>
              {card.action.label}
            </Link>
          ) : null}

          <p className="mt-3 text-center text-xs text-[#8A8A90]">{card.footer}</p>
        </div>
      </article>
    </Shell>
  );
}
