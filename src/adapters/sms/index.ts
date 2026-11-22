import "server-only";
import { getEnvironment } from "@/configuration/environment";
import { advantaSms } from "./advanta";
import { africasTalkingSms } from "./africastalking";
import { bongaTechSms } from "./bongatech";
import { consoleSms } from "./console";
import type { SmsSender } from "./types";

export type { SmsResult, SmsSender, SmsStatus } from "./types";

/** The SMS sender chosen by SMS_PROVIDER. */
export function getSmsSender(): SmsSender {
  const provider = getEnvironment().SMS_PROVIDER;
  if (provider === "africastalking") return africasTalkingSms;
  if (provider === "advanta") return advantaSms;
  if (provider === "bongatech") return bongaTechSms;
  return consoleSms;
}
