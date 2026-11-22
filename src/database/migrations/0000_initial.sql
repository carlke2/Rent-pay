CREATE TYPE "public"."unit_status" AS ENUM('vacant', 'occupied', 'reserved', 'under_repair');--> statement-breakpoint
CREATE TYPE "public"."lease_status" AS ENUM('active', 'notice', 'ended');--> statement-breakpoint
CREATE TYPE "public"."invoice_line_type" AS ENUM('rent', 'water', 'fixed', 'penalty', 'deposit', 'other');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('rent', 'deposit');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('charge', 'payment', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('stk', 'paybill', 'bank', 'cash');--> statement-breakpoint
CREATE TYPE "public"."payment_claim_status" AS ENUM('waiting', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_match_status" AS ENUM('matched', 'unmatched', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_request_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"code_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_code_prefix_unique" UNIQUE("code_prefix")
);
--> statement-breakpoint
CREATE TABLE "landlord" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landlord_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"floor" integer,
	"rent_amount" integer NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"meter_number" text,
	"status" "unit_status" DEFAULT 'vacant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code"),
	CONSTRAINT "units_amounts_not_negative" CHECK ("units"."rent_amount" >= 0 and "units"."deposit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"rent_amount" integer NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"status" "lease_status" DEFAULT 'active' NOT NULL,
	"notice_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leases_amounts_not_negative" CHECK ("leases"."rent_amount" >= 0 and "leases"."deposit_amount" >= 0),
	CONSTRAINT "leases_end_after_start" CHECK ("leases"."end_date" is null or "leases"."end_date" >= "leases"."start_date")
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"national_id" text,
	"phone" text NOT NULL,
	"alternative_phone" text,
	"whatsapp_opt_in" boolean DEFAULT false NOT NULL,
	"next_of_kin" jsonb,
	"portal_access" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"type" "invoice_line_type" NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"rate" integer NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_amount_not_negative" CHECK ("invoice_lines"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"period" text NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_lease_period_unique" UNIQUE("lease_id","period"),
	CONSTRAINT "invoices_period_format" CHECK ("invoices"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "invoices_total_not_negative" CHECK ("invoices"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"period" text NOT NULL,
	"previous_reading" integer NOT NULL,
	"current_reading" integer NOT NULL,
	"read_on" date NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meter_readings_unit_period_unique" UNIQUE("unit_id","period"),
	CONSTRAINT "meter_readings_period_format" CHECK ("meter_readings"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_amount_positive" CHECK ("allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"account" "ledger_account" DEFAULT 'rent' NOT NULL,
	"reference" text NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"invoice_line_id" uuid,
	"payment_id" uuid,
	"reverses_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_reverses_entry_id_unique" UNIQUE("reverses_entry_id"),
	CONSTRAINT "ledger_entries_one_side" CHECK ("ledger_entries"."debit" >= 0 and "ledger_entries"."credit" >= 0 and ("ledger_entries"."debit" = 0) <> ("ledger_entries"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"channel" "message_channel" DEFAULT 'sms' NOT NULL,
	"template" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"cost" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"slip_key" text,
	"status" "payment_claim_status" DEFAULT 'waiting' NOT NULL,
	"reason" text,
	"payment_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_claims_amount_positive" CHECK ("payment_claims"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"phone" text NOT NULL,
	"checkout_request_id" text,
	"merchant_request_id" text,
	"status" "payment_request_status" DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"result_description" text,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_requests_checkout_request_id_unique" UNIQUE("checkout_request_id"),
	CONSTRAINT "payment_requests_amount_positive" CHECK ("payment_requests"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mpesa_receipt" text,
	"channel" "payment_channel" NOT NULL,
	"amount" integer NOT NULL,
	"account_reference" text,
	"payer_name" text,
	"payer_phone" text,
	"paid_at" timestamp with time zone NOT NULL,
	"lease_id" uuid,
	"match_status" "payment_match_status" DEFAULT 'unmatched' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_mpesa_receipt_unique" UNIQUE("mpesa_receipt"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"number" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "receipts_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "receipts_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid,
	"effective_from" date NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_building_id_index" ON "units" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "leases_tenant_id_index" ON "leases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leases_unit_id_index" ON "leases" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leases_one_current_per_unit" ON "leases" USING btree ("unit_id") WHERE "leases"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "login_codes_phone_index" ON "login_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_index" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "allocations_payment_id_index" ON "allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "allocations_invoice_line_id_index" ON "allocations" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_lease_id_index" ON "ledger_entries" USING btree ("lease_id","entry_date");--> statement-breakpoint
CREATE INDEX "messages_recipient_index" ON "messages" USING btree ("recipient");--> statement-breakpoint
CREATE INDEX "payment_claims_status_index" ON "payment_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_requests_lease_id_index" ON "payment_requests" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "payment_requests_status_index" ON "payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_lease_id_index" ON "payments" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "payments_match_status_index" ON "payments" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "policies_building_effective_index" ON "policies" USING btree ("building_id","effective_from");--> statement-breakpoint
CREATE INDEX "audit_log_entity_index" ON "audit_log" USING btree ("entity","entity_id");