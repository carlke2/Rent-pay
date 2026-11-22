CREATE TYPE "public"."login_code_purpose" AS ENUM('tenant_login', 'landlord_two_factor');--> statement-breakpoint
CREATE TYPE "public"."meter_reading_kind" AS ENUM('regular', 'opening', 'final');--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"category" text NOT NULL,
	"amount" integer NOT NULL,
	"spent_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pay_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_changes_amount_not_negative" CHECK ("rent_changes"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "meter_readings" DROP CONSTRAINT "meter_readings_unit_period_unique";--> statement-breakpoint
ALTER TABLE "allocations" DROP CONSTRAINT "allocations_amount_positive";--> statement-breakpoint
DROP INDEX "login_codes_phone_index";--> statement-breakpoint
ALTER TABLE "landlord" ADD COLUMN "two_factor_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "move_out_date" date;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "deposit_refund_due" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "deposit_refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "deposit_refunded_on" date;--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "purpose" "login_code_purpose" DEFAULT 'tenant_login' NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD COLUMN "kind" "meter_reading_kind" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_links" ADD CONSTRAINT "pay_links_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_changes" ADD CONSTRAINT "rent_changes_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_building_spent_index" ON "expenses" USING btree ("building_id","spent_on");--> statement-breakpoint
CREATE INDEX "pay_links_lease_id_index" ON "pay_links" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "rent_changes_lease_effective_index" ON "rent_changes" USING btree ("lease_id","effective_from");--> statement-breakpoint
CREATE INDEX "login_codes_phone_index" ON "login_codes" USING btree ("phone","purpose","created_at");--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_unit_period_kind_unique" UNIQUE("unit_id","period","kind");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_amount_not_zero" CHECK ("allocations"."amount" <> 0);