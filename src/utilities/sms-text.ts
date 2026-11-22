/** Basic GSM 7-bit alphabet (excluding extension table). */
const GSM_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ",
    ' !"#¤%&\'()*+,-./0123456789:;<=>?',
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§",
    "¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ].join(""),
);

/** Normalise text toward GSM-7 so SMS stays single-segment when possible. */
export function toGsm7(text: string): string {
  const normalised = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...");

  let out = "";
  for (const char of normalised) {
    if (GSM_BASIC.has(char)) out += char;
  }
  return out;
}

/**
 * Build an SMS body under 160 GSM characters: always include `required`, then append
 * optional parts in order until the next one would exceed the limit.
 */
export function fitSms(parts: { required: string; optional: string[] }): string {
  let body = toGsm7(parts.required);
  for (const part of parts.optional) {
    const next = toGsm7(body + part);
    if (next.length > 160) break;
    body = next;
  }
  return body;
}

/** Prefix for SMS copy, e.g. `Rental: `. */
export function smsPrefix(appName: string): string {
  return `${appName}: `;
}

/**
 * SMS-friendly link without a protocol.
 * `https://example.com` + `/receipts/abc` → `example.com/receipts/abc`
 */
export function smsLink(appUrl: string, path: string): string {
  const host = appUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${host}/${cleanPath}`;
}
