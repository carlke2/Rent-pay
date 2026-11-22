import { normaliseKenyanPhone } from "@/utilities/phone";

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
}

function samePhone(a: string, b: string): boolean {
  const left = normaliseKenyanPhone(a) ?? a.replace(/\D/g, "");
  const right = normaliseKenyanPhone(b) ?? b.replace(/\D/g, "");
  return left.length > 0 && left === right;
}

/**
 * Whether someone other than the lease's tenant made a payment. Information only: never blocks or unmatches.
 * - Paybill: the payer's name (Safaricom's FirstName) shares no word with the tenant's full name.
 * - STK push: the phone the prompt was sent to is neither the tenant's phone nor their alternative phone.
 * Anything we can't compare (no payer name, no prompt phone) is not flagged.
 */
export function isPaidByOther(input: {
  channel: "stk" | "paybill" | "bank" | "cash" | "cheque" | "opening";
  payerName: string | null;
  promptPhone: string | null;
  tenant: { fullName: string; phone: string; alternativePhone: string | null };
}): boolean {
  if (input.channel === "paybill") {
    const payer = nameWords(input.payerName ?? "");
    if (payer.length === 0) return false;
    const tenant = new Set(nameWords(input.tenant.fullName));
    return !payer.some((word) => tenant.has(word));
  }
  if (input.channel === "stk") {
    if (!input.promptPhone) return false;
    const tenantPhones = [input.tenant.phone, input.tenant.alternativePhone].filter((phone): phone is string => Boolean(phone));
    return !tenantPhones.some((phone) => samePhone(phone, input.promptPhone as string));
  }
  return false;
}

/** "Paid by Jane 2547*****126", or "Paid by someone else" when neither is known. */
export function describeOtherPayer(payerName: string | null, payerPhone: string | null): string {
  const who = [payerName, payerPhone].filter(Boolean).join(" ");
  return who ? `Paid by ${who}` : "Paid by someone else";
}
