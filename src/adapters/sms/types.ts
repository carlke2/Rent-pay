import "server-only";

export type SmsStatus = "sent" | "failed";

export type SmsResult = {
  providerId: string | null;
  status: SmsStatus;
  /** Provider-reported cost as given (e.g. "KES 0.8000"). */
  cost: string | null;
};

export interface SmsSender {
  /** `to` is 2547XXXXXXXX / 2541XXXXXXXX. */
  send(to: string, message: string): Promise<SmsResult>;
}
