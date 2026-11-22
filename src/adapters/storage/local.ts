import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnvironment } from "@/configuration/environment";
import { assertSafeKey, type FileStorage } from "./types";

/** Development only: files go to STORAGE_LOCAL_DIRECTORY and are served by /api/files with a signed URL. */
function root(): string {
  // Development only, so keep it out of build tracing.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), getEnvironment().STORAGE_LOCAL_DIRECTORY);
}

function filePath(key: string): string {
  const resolved = path.resolve(root(), assertSafeKey(key));
  if (!resolved.startsWith(root() + path.sep)) throw new Error("Storage key escapes the storage folder");
  return resolved;
}

function sign(key: string, expires: number): string {
  return createHmac("sha256", getEnvironment().SESSION_SECRET).update(`file:${key}:${expires}`).digest("base64url");
}

export function verifyLocalSignature(key: string, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(key, expires));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function readLocalFile(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const target = filePath(key);
  const [bytes, meta] = await Promise.all([readFile(target), readFile(`${target}.type`, "utf8").catch(() => "application/octet-stream")]);
  return { bytes, contentType: meta.trim() };
}

let warned = false;

export const localStorage: FileStorage = {
  async put(key, bytes, contentType) {
    if (!warned && getEnvironment().NODE_ENV === "production") {
      warned = true;
      console.warn("[storage] STORAGE_PROVIDER=local is for development only; files on a server disk can be lost. Use s3.");
    }
    const target = filePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await writeFile(`${target}.type`, contentType);
  },
  async getSignedUrl(key, expiresInSeconds = 600) {
    assertSafeKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const base = getEnvironment().APP_URL.replace(/\/+$/, "");
    return `${base}/api/files/${key}?expires=${expires}&signature=${sign(key, expires)}`;
  },
};
