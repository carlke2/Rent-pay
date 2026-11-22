import { requireLandlord } from "@/authentication/roles";
import { buildImportTemplate } from "@/services/imports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The opening-balance import template (.xlsx). */
export async function GET() {
  await requireLandlord();
  const bytes = await buildImportTemplate();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="opening-balance-import.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
