CREATE TYPE "public"."payment_callback_kind" AS ENUM('stk', 'paybill_validation', 'paybill_confirmation');--> statement-breakpoint
CREATE TABLE "payment_callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "payment_callback_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "normalised_code" text GENERATED ALWAYS AS (upper(regexp_replace(code, '[[:space:]-]+', '', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "payment_callbacks_processed_at_index" ON "payment_callbacks" USING btree ("processed_at");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_normalised_code_unique" UNIQUE("normalised_code");