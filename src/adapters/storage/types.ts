import "server-only";

export interface FileStorage {
  /** Stores bytes under a key like "slips/<leaseId>/<uuid>.jpg". */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A time-limited URL to view the file. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Reads a file (for files streamed through our own route handlers, e.g. avatars). Null when it doesn't exist. */
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** Deletes a file; deleting a missing file is not an error. */
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,300}$/;

/** Rejects keys that could escape the storage folder or bucket prefix. */
export function assertSafeKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error(`Unsafe storage key: ${key}`);
  return key;
}
