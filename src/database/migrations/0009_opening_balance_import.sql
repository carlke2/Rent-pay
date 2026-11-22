ALTER TYPE "payment_channel" ADD VALUE IF NOT EXISTS 'cheque';--> statement-breakpoint
ALTER TYPE "payment_channel" ADD VALUE IF NOT EXISTS 'opening';--> statement-breakpoint
ALTER TYPE "payment_match_status" ADD VALUE IF NOT EXISTS 'imported';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"cut_over_date" date NOT NULL,
	"actor" text NOT NULL,
	"units_imported" integer DEFAULT 0 NOT NULL,
	"counts" jsonb,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "history" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_valid" CHECK ("source" in ('live', 'opening', 'import'));--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_lease_period_unique";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lease_period_source_unique" UNIQUE("lease_id","period","source");--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;
