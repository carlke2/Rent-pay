ALTER TABLE "invoice_lines" ADD COLUMN "waived_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "lease_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "related_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_lease_template_created_index" ON "messages" USING btree ("lease_id","template","created_at");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_waived_within_amount" CHECK ("invoice_lines"."waived_amount" >= 0 and "invoice_lines"."waived_amount" <= "invoice_lines"."amount");