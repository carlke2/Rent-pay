import "server-only";
import { z } from "zod";

// ---- requests we send ----

export type StkPushRequest = {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: "CustomerPayBillOnline";
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
};

export type StkStatusRequest = {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  CheckoutRequestID: string;
};

export type RegisterUrlRequest = {
  ShortCode: string;
  ResponseType: "Completed" | "Cancelled";
  ConfirmationURL: string;
  ValidationURL: string;
};

export type SimulateRequest = {
  ShortCode: string;
  CommandID: "CustomerPayBillOnline";
  Amount: number;
  Msisdn: string;
  BillRefNumber: string;
};

// ---- responses we receive ----

export type AccessTokenResponse = { access_token: string; expires_in: string };

export type StkPushResponse = {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
};

export type StkStatusResponse = {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
};

export type RegisterUrlResponse = {
  OriginatorCoversationID?: string;
  OriginatorConversationID?: string;
  ResponseCode: string;
  ResponseDescription: string;
};

export type SimulateResponse = {
  OriginatorCoversationID?: string;
  OriginatorConversationID?: string;
  ResponseCode: string;
  ResponseDescription: string;
};

/** Daraja's error body, e.g. { requestId, errorCode: "404.001.03", errorMessage: "Invalid Access Token" }. */
export type DarajaErrorBody = { requestId?: string; errorCode?: string; errorMessage?: string };

// ---- callbacks Daraja sends us (validated, since they come from outside) ----

const metadataValue = z.union([z.string(), z.number()]).optional();

export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.coerce.number().int(),
      ResultDesc: z.string(),
      CallbackMetadata: z
        .object({ Item: z.array(z.object({ Name: z.string(), Value: metadataValue })) })
        .optional(),
    }),
  }),
});
export type StkCallback = z.infer<typeof stkCallbackSchema>["Body"]["stkCallback"];

/** C2B v2 validation and confirmation body. MSISDN arrives masked, e.g. 2547*****126. */
export const paybillCallbackSchema = z.object({
  TransactionType: z.string().optional(),
  TransID: z.string().min(1),
  TransTime: z.coerce.string(),
  TransAmount: z.coerce.string(),
  BusinessShortCode: z.coerce.string().optional(),
  BillRefNumber: z.coerce.string().default(""),
  InvoiceNumber: z.coerce.string().optional(),
  OrgAccountBalance: z.coerce.string().optional(),
  ThirdPartyTransID: z.coerce.string().optional(),
  MSISDN: z.coerce.string().optional(),
  FirstName: z.string().optional(),
  MiddleName: z.string().optional(),
  LastName: z.string().optional(),
});
export type PaybillCallback = z.infer<typeof paybillCallbackSchema>;

/** STK result codes we treat specially. */
export const STK_RESULT_CODES = { success: 0, cancelled: 1032, timedOut: 1037 } as const;
