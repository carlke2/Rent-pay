/**
 * Normalises a Kenyan mobile number to 2547XXXXXXXX / 2541XXXXXXXX.
 * Accepts 07…, 01…, 7…, 1…, +254…, 254…, with spaces or dashes. Returns null if invalid.
 */
export function normaliseKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  let local: string;
  if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) local = digits;
  else return null;
  return `254${local}`;
}

/** 254712345678 → +254 7•• ••• 678 */
export function maskPhoneInternational(phone: string): string {
  const local = phone.startsWith("254") ? phone.slice(3) : phone.replace(/^0/, "");
  return `+254 ${local.slice(0, 1)}•• ••• ${local.slice(-3)}`;
}

/** 254712345678 → 0712 ••• 678 */
export function maskPhone(phone: string): string {
  const local = phone.startsWith("254") ? `0${phone.slice(3)}` : phone;
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`;
}
