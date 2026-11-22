import { randomBytes } from "node:crypto";

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Cryptographically random Base62 string of the given length. */
export function randomShortCode(length: number): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`length must be a positive integer, got ${length}`);
  }
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += BASE62[bytes[i]! % 62];
  }
  return code;
}

/** Keeps generating codes until `exists` returns false. */
export async function uniqueShortCode(
  length: number,
  exists: (code: string) => Promise<boolean>,
): Promise<string> {
  for (;;) {
    const code = randomShortCode(length);
    if (!(await exists(code))) return code;
  }
}
