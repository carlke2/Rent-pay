import "server-only";
import { sql } from "drizzle-orm";
import { normaliseUnitCode } from "@/core/payments";
import { getDatabase } from "@/database/client";
import { formatShillings } from "@/utilities/money";

export type SearchResult = { kind: "tenant" | "unit" | "payment"; id: string; title: string; detail: string; href: string };

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/**
 * The landlord's quick search: tenants by name or phone, units by code, payments by M-Pesa receipt or receipt number.
 * Up to `limit` results of each kind.
 */
export async function searchEverything(input: { text: string; limit?: number }): Promise<SearchResult[]> {
  const text = input.text.trim().slice(0, 60);
  if (text.length < 2) return [];
  const limit = input.limit ?? 5;
  const pattern = likePattern(text);
  // Phones are stored as 2547XXXXXXXX; let "0712…" find them too.
  const digits = text.replace(/\D/g, "");
  const phonePattern = digits.length >= 3 ? likePattern(digits.startsWith("0") ? `254${digits.slice(1)}` : digits) : null;
  const database = getDatabase();

  const [tenantRows, unitRows, paymentRows] = await Promise.all([
    database.execute(sql`
      select t.id, t.full_name as "fullName", t.phone, u.code as "unitCode"
      from tenants t
      left join leases l on l.tenant_id = t.id and l.status in ('active', 'notice')
      left join units u on u.id = l.unit_id
      where t.full_name ilike ${pattern} ${phonePattern ? sql`or t.phone like ${phonePattern} or t.alternative_phone like ${phonePattern}` : sql``}
      order by t.full_name limit ${limit}`),
    database.execute(sql`
      select u.id, u.code, b.name as "buildingName", u.status
      from units u join buildings b on b.id = u.building_id
      where u.code ilike ${pattern} or u.normalised_code like ${likePattern(normaliseUnitCode(text))}
      order by u.code limit ${limit}`),
    database.execute(sql`
      select p.id, p.amount, p.mpesa_receipt as "mpesaReceipt", r.number as "receiptNumber", p.match_status as "matchStatus", u.code as "unitCode"
      from payments p
      left join receipts r on r.payment_id = p.id
      left join leases l on l.id = p.lease_id left join units u on u.id = l.unit_id
      where p.mpesa_receipt ilike ${pattern} or r.number ilike ${pattern}
      order by p.paid_at desc limit ${limit}`),
  ]);

  type TenantRow = { id: string; fullName: string; phone: string; unitCode: string | null };
  type UnitRow = { id: string; code: string; buildingName: string; status: string };
  type PaymentRow = { id: string; amount: number; mpesaReceipt: string | null; receiptNumber: string | null; matchStatus: string; unitCode: string | null };

  return [
    ...([...tenantRows] as TenantRow[]).map((row) => ({
      kind: "tenant" as const,
      id: row.id,
      title: row.fullName,
      detail: [row.unitCode, `0${row.phone.slice(3)}`].filter(Boolean).join(" · "),
      href: `/admin/tenants/${row.id}`,
    })),
    ...([...unitRows] as UnitRow[]).map((row) => ({
      kind: "unit" as const,
      id: row.id,
      title: row.code,
      detail: `${row.buildingName} · ${row.status.replace(/_/g, " ")}`,
      href: `/admin/units/${row.id}`,
    })),
    ...([...paymentRows] as PaymentRow[]).map((row) => ({
      kind: "payment" as const,
      id: row.id,
      title: row.mpesaReceipt ?? row.receiptNumber ?? "Payment",
      detail: [formatShillings(row.amount), row.unitCode, row.receiptNumber && row.mpesaReceipt ? row.receiptNumber : null, row.matchStatus].filter(Boolean).join(" · "),
      href: row.matchStatus === "unmatched" ? `/admin/payments?tab=unmatched&payment=${row.id}` : `/admin/payments?payment=${row.id}`,
    })),
  ];
}
