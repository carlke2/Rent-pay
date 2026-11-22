import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Logo } from "@/components/shared/logo";
import { ReceiptActions } from "@/components/shared/receipt-actions";
import { getEnvironment } from "@/configuration/environment";
import { getReceiptByToken } from "@/services/payments";
import {
  addMonthsToPeriod,
  formatDate,
  formatNairobiDateTime,
  formatPeriod,
  type BillingPeriod,
  type IsoDate,
} from "@/utilities/dates";
import { formatAmount, formatShillings } from "@/utilities/money";
import { maskPhone } from "@/utilities/phone";
import { smsLink } from "@/utilities/sms-text";

function formatSmsDateSafe(date: IsoDate): string {
  return formatDate(date).replace(/\s+\d{4}$/, "");
}

/** Generic on purpose: link previews must never show amounts, names, unit codes or phone numbers. */
export async function generateMetadata(): Promise<Metadata> {
  const appName = getEnvironment().APP_NAME;
  const title = `Payment receipt · ${appName}`;
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

const CHANNELS = { stk: "M-Pesa", paybill: "M-Pesa Paybill", bank: "Bank", cash: "Cash", cheque: "Cheque", opening: "Opening balance" } as const;

type StatusKey = "part" | "paid" | "overpaid" | "reversed";

const STATUS: Record<
  StatusKey,
  { pill: string; boxBg: string; boxBorder: string; text: string; bar: string; label: string }
> = {
  part: {
    pill: "#FEF3C7",
    boxBg: "#FFFBEB",
    boxBorder: "#FDE68A",
    text: "#92400E",
    bar: "#D97706",
    label: "Part payment",
  },
  paid: {
    pill: "#DCFCE7",
    boxBg: "#F0FDF4",
    boxBorder: "#BBF7D0",
    text: "#166534",
    bar: "#16A34A",
    label: "Fully paid",
  },
  overpaid: {
    pill: "#DCFCE7",
    boxBg: "#F0FDF4",
    boxBorder: "#BBF7D0",
    text: "#166534",
    bar: "#16A34A",
    label: "Fully paid",
  },
  reversed: {
    pill: "#FEE2E2",
    boxBg: "#FEF2F2",
    boxBorder: "#FECACA",
    text: "#991B1B",
    bar: "#DC2626",
    label: "Reversed",
  },
};

function coverLabel(item: { description: string; type: string; period: string }): string {
  const periodLabel = formatPeriod(item.period as BillingPeriod);
  if (item.type === "rent") return `Rent · ${periodLabel}`;
  if (item.type === "water") {
    const unitsMatch = /\((\d+)\s*units?\)/i.exec(item.description);
    const rangeMatch = /\((\d+)\s+to\s+(\d+)\)/i.exec(item.description);
    if (unitsMatch && rangeMatch) return `Water · ${unitsMatch[1]} units (${rangeMatch[1]} to ${rangeMatch[2]})`;
    if (unitsMatch) return `Water · ${unitsMatch[1]} units`;
    return `Water · ${periodLabel}`;
  }
  if (item.type === "deposit") return `Deposit · ${periodLabel}`;
  if (item.type === "penalty") return `Late fee · ${periodLabel}`;
  if (item.type === "fixed" || item.type === "other") {
    const name = item.description.split(/\s+\d{4}/)[0]?.replace(/\s+(January|February|March|April|May|June|July|August|September|October|November|December).*$/i, "").trim() || item.description;
    return `${name} · ${periodLabel}`;
  }
  return item.description.includes("·") ? item.description : item.description.replace(/^(\S+)\s+/, "$1 · ");
}

function referenceLabel(channel: keyof typeof CHANNELS, mpesaReceipt: string | null, reference: string | null): string {
  if (channel === "cash") return "Cash";
  if (channel === "bank") return reference ? `Bank ref ${reference}` : "Bank";
  if (mpesaReceipt) return `M-Pesa ${mpesaReceipt}`;
  return reference ?? CHANNELS[channel];
}

/** Public, printable receipt (short code or long token). */
export default async function ReceiptPage({ params }: PageProps<"/receipts/[token]">) {
  const { token } = await params;
  const receipt = await getReceiptByToken(token);
  if (!receipt) notFound();

  const env = getEnvironment();
  const code = receipt.shortCode ?? receipt.token;
  const fullUrl = `${env.APP_URL.replace(/\/+$/, "")}/receipts/${code}`;
  const verifyHost = smsLink(env.APP_URL, `/receipts/${code}`);

  const statusKey: StatusKey = receipt.voidedAt
    ? "reversed"
    : receipt.balanceAfter > 0
      ? "part"
      : receipt.balanceAfter < 0
        ? "overpaid"
        : "paid";
  const status = STATUS[statusKey];
  const monthLabel = receipt.primaryPeriod ? formatPeriod(receipt.primaryPeriod as BillingPeriod).replace(/\s+\d{4}$/, "") : "This month";
  const nextMonthLabel = receipt.primaryPeriod
    ? formatPeriod(addMonthsToPeriod(receipt.primaryPeriod as BillingPeriod, 1)).replace(/\s+\d{4}$/, "")
    : "next month";
  const dueLabel = receipt.dueDate ? formatSmsDateSafe(receipt.dueDate) : null;
  const progress = receipt.billTotal > 0 ? Math.min(100, Math.round((receipt.paidSoFar / receipt.billTotal) * 100)) : statusKey === "paid" || statusKey === "overpaid" ? 100 : 0;

  const qrSvg = await QRCode.toString(fullUrl, {
    type: "svg",
    width: 68,
    margin: 0,
    color: { dark: "#111111", light: "#00000000" },
    errorCorrectionLevel: "M",
  });

  const dateLine = [
    formatNairobiDateTime(receipt.paidAt),
    CHANNELS[receipt.channel],
    receipt.voidedAt ? `reversed ${formatNairobiDateTime(receipt.voidedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const credit = receipt.balanceAfter < 0 ? -receipt.balanceAfter : 0;
  const shareText = `Receipt ${receipt.receiptNumber}: ${fullUrl}`;

  return (
    <main className="min-h-dvh bg-[#F5F5F4] px-[max(1rem,env(safe-area-inset-left))] pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] print:bg-white print:p-0">
      <article
        className="relative mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white print:overflow-visible print:rounded-none print:border-0"
        style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as CSSProperties}
      >
        {receipt.voidedAt ? (
          <div
            aria-label="Void"
            className="pointer-events-none absolute top-1/3 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] rounded-lg border-4 border-[#B91C1C] px-5 py-1 text-[36px] font-bold tracking-widest text-[#B91C1C] opacity-90"
          >
            VOID
          </div>
        ) : null}

        <header className="flex items-center justify-between gap-4 bg-[#111111] px-4 py-2.5 text-white">
          <div className="flex min-w-0 items-center">
            <Logo variant="dark" kind="full" height={28} priority />
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-[#C9C9CF]">Payment receipt</p>
            <p className="numbers text-[13px] font-semibold tabular-nums">{receipt.receiptNumber}</p>
          </div>
        </header>
        <div className="h-[3px] bg-[#C49A45]" aria-hidden />

        <section className="flex items-start justify-between gap-3 px-4 pt-3 pb-2.5">
          <div className="min-w-0">
            <span
              className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: status.pill, color: status.text }}
            >
              {status.label}
            </span>
            <p
              className={`numbers mt-2 font-sans text-[32px] leading-none font-semibold tracking-[-0.02em] tabular-nums ${receipt.voidedAt ? "text-[#A8A29E] line-through" : "text-[#111111]"}`}
            >
              {formatShillings(receipt.amount)}
            </p>
            <p className="mt-1.5 text-[13px] text-[#57534E]">{dateLine}</p>
          </div>
          <div className="flex w-[68px] shrink-0 flex-col items-center gap-1">
            <div className="size-[68px] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="text-center text-[10px] text-[#78716C]">Scan to verify</p>
          </div>
        </section>

        <dl className="mx-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-dashed border-[#E7E5E4] py-2.5 text-[13px]">
          <dt className="text-[#78716C]">Received from</dt>
          <dd className="text-right font-medium text-[#111111]">
            <div>{receipt.tenantName}</div>
            {receipt.paidByOther ? (
              <div className="mt-0.5 text-xs font-normal text-[#57534E]">
                Paid by {[receipt.payerName, receipt.payerPhone ? maskPhone(receipt.payerPhone) : null].filter(Boolean).join(" ") || "Someone else"}
              </div>
            ) : null}
          </dd>
          <dt className="text-[#78716C]">Unit</dt>
          <dd className="numbers text-right font-medium tabular-nums text-[#111111]">
            {receipt.unitCode} · {receipt.buildingName}
          </dd>
          <dt className="text-[#78716C]">Reference</dt>
          <dd className="numbers text-right font-medium tabular-nums text-[#111111]">
            {referenceLabel(receipt.channel, receipt.mpesaReceipt, receipt.reference)}
          </dd>
        </dl>

        <section className="mx-4 border-t border-dashed border-[#E7E5E4] py-2.5">
          <h2 className="mb-1.5 text-[13px] font-semibold text-[#111111]">What this payment covered</h2>
          {receipt.voidedAt ? (
            <p className="text-sm text-[#78716C]">Nothing. This payment was reversed, so it no longer counts towards any bill.</p>
          ) : receipt.covered.length === 0 ? (
            <p className="text-sm text-[#78716C]">
              {credit > 0 ? `Credit ${formatShillings(credit)} for future bills` : "Nothing allocated."}
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[13px]">
              {receipt.covered.map((item, index) => (
                <li key={index} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[#111111]">{coverLabel(item)}</p>
                    {item.amount < item.lineAmount ? (
                      <p className="text-xs text-[#A8A29E]">of {formatAmount(item.lineAmount)}</p>
                    ) : null}
                  </div>
                  <p className="numbers shrink-0 font-semibold tabular-nums text-[#111111]">{formatShillings(item.amount)}</p>
                </li>
              ))}
              {credit > 0 && statusKey === "overpaid" ? (
                <li className="flex justify-between gap-3 text-[#166534]">
                  <span>Credit to {nextMonthLabel}</span>
                  <span className="numbers font-semibold tabular-nums">{formatShillings(credit)}</span>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        <section
          className="mx-4 mb-3 rounded-xl border px-3 py-2.5"
          style={{ backgroundColor: status.boxBg, borderColor: status.boxBorder, color: status.text }}
        >
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span>
              <span className="font-medium">{monthLabel} bill</span>{" "}
              <span className="numbers font-semibold tabular-nums">{formatShillings(receipt.billTotal)}</span>
            </span>
            <span className="numbers tabular-nums">Paid {formatShillings(receipt.paidSoFar)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: status.bar }} />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium">
              {statusKey === "part" && dueLabel ? `Balance due ${dueLabel}` : null}
              {statusKey === "part" && !dueLabel ? "Balance" : null}
              {statusKey === "paid" ? `${monthLabel} fully paid` : null}
              {statusKey === "overpaid" ? `Credit to ${nextMonthLabel}` : null}
              {statusKey === "reversed" ? "This receipt is void" : null}
            </p>
            <p className="numbers shrink-0 text-lg font-semibold tracking-[-0.02em] tabular-nums">
              {statusKey === "reversed"
                ? formatShillings(0)
                : statusKey === "overpaid"
                  ? formatShillings(-credit)
                  : formatShillings(Math.max(0, receipt.balanceAfter))}
            </p>
          </div>
        </section>

        <footer className="flex items-end justify-between gap-4 border-t border-[#E7E5E4] bg-[#FAFAF9] px-4 py-2.5 print:bg-[#FAFAF9]">
          <div className="min-w-0 text-[11px] leading-snug text-[#57534E]">
            <p>
              Issued automatically by {env.APP_NAME} for {receipt.landlordName.trim()}
              {receipt.landlordPhone ? `, ${receipt.landlordPhone}` : ""}
            </p>
            <p className="mt-0.5 break-all">Verify at {verifyHost}</p>
          </div>
          <ReceiptActions receiptUrl={fullUrl} shareText={shareText} />
        </footer>
      </article>

      <style>{`
        @media print {
          @page { margin: 12mm; size: auto; }
          body { background: white !important; }
          main { padding: 0 !important; background: white !important; }
        }
      `}</style>
    </main>
  );
}

