import { z } from "zod";

/** Treats empty strings (e.g. `KEY=` in .env) as "not set". */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const secret = (minimumLength: number) =>
  z.string().trim().min(minimumLength, `must be at least ${minimumLength} characters`);

const shortcode = z.string().trim().regex(/^\d{5,7}$/, "must be a 5-7 digit shortcode");

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.url(),
    /** Shown in the app title, the sidebar and as the SMS signature. */
    APP_NAME: z.string().trim().min(1).max(30).default("RentPay"),
    /** Shown on the landlord sign-in page ("Contact support", "Forgot password?"). Optional. */
    SUPPORT_EMAIL: optionalText.pipe(z.email().optional()),
    /** Bank details shown to tenants who pay by bank transfer (all optional). */
    BANK_NAME: optionalText,
    BANK_BRANCH: optionalText,
    BANK_ACCOUNT_NAME: optionalText,
    BANK_ACCOUNT_NUMBER: optionalText,

    DATABASE_URL: z.url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),

    SESSION_SECRET: secret(32),
    CRON_SECRET: secret(16),

    MPESA_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
    MPESA_CONSUMER_KEY: optionalText,
    MPESA_CONSUMER_SECRET: optionalText,
    /** Paybill used for C2B. */
    MPESA_SHORTCODE: shortcode,
    /** STK push shortcode; defaults to MPESA_SHORTCODE (they differ only in the sandbox). */
    MPESA_STK_SHORTCODE: optionalText.pipe(shortcode.optional()),
    MPESA_STK_PASSKEY: z.string().trim().min(1),
    MPESA_CALLBACK_KEY: secret(16).regex(/^[A-Za-z0-9_-]+$/, "must be URL-safe (letters, digits, - and _)"),

    SMS_PROVIDER: z.enum(["console", "africastalking", "advanta", "bongatech"]).default("console"),
    AT_USERNAME: optionalText,
    AT_API_KEY: optionalText,
    AT_SENDER_ID: optionalText,
    /** Advanta Africa (quicksms.advantasms.com). */
    ADVANTA_SMS_URL: optionalText.pipe(z.url().optional()),
    ADVANTA_API_KEY: optionalText,
    ADVANTA_PARTNER_ID: optionalText,
    ADVANTA_SHORTCODE: optionalText,
    /** BongaTech (bulk.bongatech.co.ke). */
    BONGATECH_API_URL: optionalText.pipe(z.url().optional()),
    BONGATECH_API_KEY: optionalText,
    BONGATECH_PARTNER_ID: optionalText,
    BONGATECH_SENDER_ID: optionalText,
    /** Optional full Authorization header value; defaults to `Bearer ${BONGATECH_API_KEY}`. */
    BONGATECH_AUTH_HEADER: optionalText,

    QUEUE_PROVIDER: z.enum(["inline", "qstash"]).default("inline"),
    QSTASH_URL: z.url().default("https://qstash.upstash.io"),
    QSTASH_TOKEN: optionalText,

    STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIRECTORY: z.string().trim().min(1).default("./storage"),
    S3_ENDPOINT: optionalText.pipe(z.url().optional()),
    S3_REGION: optionalText,
    S3_BUCKET: optionalText,
    S3_ACCESS_KEY_ID: optionalText,
    S3_SECRET_ACCESS_KEY: optionalText,

    /** Set by Vercel on its servers ("1"); used to insist on S3 storage there. */
    VERCEL: optionalText,
    /** Set by Vercel to "production", "preview" or "development"; unset when the app runs anywhere else. */
    VERCEL_ENV: optionalText,

    /** Local development only: offers the phone + unit code "Test sign-in" to tenants. See isTestSignInEnabled(). */
    ENABLE_TEST_SIGNIN: optionalText.transform((value) => value?.toLowerCase() === "true"),

    SEED_LANDLORD_EMAIL: optionalText.pipe(z.email().optional()),
    SEED_LANDLORD_PASSWORD: optionalText,
  })
  .superRefine((values, context) => {
    const requireWhen = (condition: boolean, keys: (keyof typeof values)[], reason: string) => {
      if (!condition) return;
      for (const key of keys) {
        if (!values[key]) {
          context.addIssue({ code: "custom", path: [key], message: `is required when ${reason}` });
        }
      }
    };

    requireWhen(values.MPESA_ENV === "live", ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET"], "MPESA_ENV=live");
    requireWhen(
      values.SMS_PROVIDER === "africastalking",
      ["AT_USERNAME", "AT_API_KEY"],
      "SMS_PROVIDER=africastalking",
    );
    requireWhen(
      values.SMS_PROVIDER === "advanta",
      ["ADVANTA_API_KEY", "ADVANTA_PARTNER_ID", "ADVANTA_SHORTCODE"],
      "SMS_PROVIDER=advanta",
    );
    requireWhen(
      values.SMS_PROVIDER === "bongatech",
      ["BONGATECH_API_KEY", "BONGATECH_SENDER_ID"],
      "SMS_PROVIDER=bongatech",
    );
    requireWhen(
      values.QUEUE_PROVIDER === "qstash",
      ["QSTASH_TOKEN"],
      "QUEUE_PROVIDER=qstash",
    );
    requireWhen(
      values.STORAGE_PROVIDER === "s3",
      ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
      "STORAGE_PROVIDER=s3",
    );
    // Fail at the first request rather than silently: live tenants can't sign in without real SMS, and
    // Vercel's filesystem is read-only, so local storage would lose every upload.
    if (values.MPESA_ENV === "live" && values.SMS_PROVIDER === "console") {
      context.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "must be a real SMS provider (not console) when MPESA_ENV=live" });
    }
    if (values.VERCEL && values.STORAGE_PROVIDER !== "s3") {
      context.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: "must be s3 on Vercel (its filesystem is read-only)" });
    }
    if (values.MPESA_ENV === "live" && !values.APP_URL.startsWith("https://")) {
      context.addIssue({ code: "custom", path: ["APP_URL"], message: "must be https:// when MPESA_ENV=live" });
    }
  })
  .transform((values) => ({ ...values, MPESA_STK_SHORTCODE: values.MPESA_STK_SHORTCODE ?? values.MPESA_SHORTCODE }));

export type Environment = z.infer<typeof environmentSchema>;

let cached: Environment | undefined;

/**
 * Reads and validates the environment on first use (never at import time),
 * so builds and unrelated code paths don't fail on missing variables.
 */
export function getEnvironment(): Environment {
  if (cached) return cached;

  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(environment)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}\nFix them in .env or in your hosting settings.`);
  }

  cached = result.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnvironment().NODE_ENV === "production";
}

/**
 * The tenant phone + unit code "Test sign-in" skips the SMS code, so it must never exist on a deployed site.
 * On only when ENABLE_TEST_SIGNIN=true AND the app is not on Vercel (VERCEL_ENV unset) AND NODE_ENV is not
 * production. Independent of MPESA_ENV. Off by default.
 */
export function isTestSignInEnabled(): boolean {
  const environment = getEnvironment();
  return environment.ENABLE_TEST_SIGNIN && !environment.VERCEL_ENV && environment.NODE_ENV !== "production";
}

/** The Paybill tenants can pay to from the M-Pesa menu: the live C2B shortcode, or null in the sandbox (test numbers). */
export function publicPaybill(): string | null {
  const environment = getEnvironment();
  return environment.MPESA_ENV === "live" ? environment.MPESA_SHORTCODE : null;
}
