"use client";

type Props = {
  receiptUrl: string;
  shareText: string;
};

/** Print (PDF) and WhatsApp share controls for the public receipt page. */
export function ReceiptActions({ receiptUrl, shareText }: Props) {
  const wa = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="flex shrink-0 items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-[#111111] px-4 py-2 text-sm font-semibold text-white"
      >
        PDF
      </button>
      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-[#111111] px-4 py-2 text-sm font-semibold text-[#111111]"
      >
        Share
      </a>
      <span className="sr-only">{receiptUrl}</span>
    </div>
  );
}
