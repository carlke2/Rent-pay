import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const OPTIONS = { N: 16384, r: 8, p: 1 } as const;

function deriveKey(password: string, salt: Buffer, options: ScryptOptions, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Hashes a password as "scrypt$N$r$p$salt$hash" (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, OPTIONS, KEY_LENGTH);
  return ["scrypt", OPTIONS.N, OPTIONS.r, OPTIONS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !hashText) return false;

  const expected = Buffer.from(hashText, "base64url");
  const actual = await deriveKey(
    password,
    Buffer.from(saltText, "base64url"),
    { N: Number(n), r: Number(r), p: Number(p) },
    expected.length,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash of a random password, used to keep login timing equal when the account doesn't exist. */
let decoyHash: Promise<string> | undefined;
export function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return decoyHash;
}
