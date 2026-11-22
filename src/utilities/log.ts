/**
 * Server logging that never prints personal data or payloads. Database errors from Drizzle carry the query's
 * parameters in their message (a raw M-Pesa callback, a phone number); SMS provider errors may echo text.
 * Use logError(label, error) instead of console.error(label, error) on the server.
 */

const PHONE = /(?<!\d)(?:\+?254|0)?([17]\d{2})\d{3}(\d{3})(?!\d)/g;
const LOGIN_CODE = /\b(code(?: is)?:?\s*)\d{4,8}\b/gi;

/** Masks Kenyan phone numbers (07xx / 2547xx / 2541xx) and login codes in free text. */
export function redact(text: string): string {
  return text.replace(PHONE, (_match, start: string, end: string) => `0${start}•••${end}`).replace(LOGIN_CODE, "$1••••••");
}

type QueryError = Error & { query?: unknown; params?: unknown; cause?: unknown };

/** One line per error: name, message and the useful part of the stack, with parameters dropped and data masked. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return redact(String(error));
  const queryError = error as QueryError;
  // Drizzle: "Failed query: …\nparams: …". Keep the database's own reason, never the parameters.
  if (queryError.query !== undefined || queryError.params !== undefined) {
    const cause = queryError.cause instanceof Error ? queryError.cause : null;
    const code = (cause as { code?: string } | null)?.code;
    return `DatabaseError${code ? ` ${code}` : ""}: ${redact(cause?.message ?? "query failed")}`;
  }
  const stack = (error.stack ?? "").split("\n").slice(1, 6).join("\n");
  const cause = error.cause ? `\n  caused by: ${describeError(error.cause)}` : "";
  return `${error.name}: ${redact(error.message)}${stack ? `\n${stack}` : ""}${cause}`;
}

export function logError(label: string, error: unknown): void {
  console.error(`${redact(label)}: ${describeError(error)}`);
}
