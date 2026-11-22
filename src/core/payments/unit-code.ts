/** Uppercases and removes spaces and dashes: " kil-a 04 " → "KILA04". */
export function normaliseUnitCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export function unitCodesMatch(a: string, b: string): boolean {
  const left = normaliseUnitCode(a);
  return left.length > 0 && left === normaliseUnitCode(b);
}
