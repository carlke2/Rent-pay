"use client";

import { useEffect } from "react";
import "./report-paper.css";
import { Printer } from "lucide-react";

/** Screen-only bar on the PDF view. Opens the print dialog once fonts have loaded (Save as PDF keeps the file name). */
export function PrintReportToolbar({ fileName, auto }: { fileName: string; auto: boolean }) {
  useEffect(() => {
    document.title = fileName;
    if (!auto) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [fileName, auto]);

  return (
    <div className="rp-toolbar" style={{ display: "flex", justifyContent: "center", gap: 12, alignItems: "center", padding: "12px 16px", background: "#18181b", color: "#fafafa", fontSize: 14 }}>
      <span>Choose “Save as PDF” as the printer. File name: {fileName}.pdf</span>
      <button
        type="button"
        onClick={() => window.print()}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#c49a45", color: "#18181b", border: 0, borderRadius: 6, padding: "6px 12px", fontWeight: 600, cursor: "pointer" }}
      >
        <Printer size={16} aria-hidden /> Save as PDF
      </button>
    </div>
  );
}
