import "server-only";
import { getEnvironment } from "@/configuration/environment";
import { localStorage } from "./local";
import { s3Storage } from "./s3";
import type { FileStorage } from "./types";

export type { FileStorage } from "./types";

/** The file store chosen by STORAGE_PROVIDER. */
export function getStorage(): FileStorage {
  return getEnvironment().STORAGE_PROVIDER === "s3" ? s3Storage : localStorage;
}

export const SLIP_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_SIGNATURES: { type: string; extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", extension: "png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/webp", extension: "webp", matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { type: "image/heic", extension: "heic", matches: (b) => ascii(b, 4, 8) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(ascii(b, 8, 12)) },
];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Checks a payment slip is an image (by its bytes, not the claimed type) and at most 5 MB. */
export function inspectSlip(bytes: Uint8Array): { contentType: string; extension: string } {
  if (bytes.byteLength === 0) throw new Error("The slip is empty");
  if (bytes.byteLength > SLIP_MAX_BYTES) throw new Error("The slip must be 5 MB or smaller");
  const match = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes));
  if (!match) throw new Error("The slip must be a photo (JPEG, PNG, WebP or HEIC)");
  return { contentType: match.type, extension: match.extension };
}
