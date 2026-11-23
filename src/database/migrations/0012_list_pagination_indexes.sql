CREATE INDEX IF NOT EXISTS "ledger_entries_lease_order_index" ON "ledger_entries" USING btree ("lease_id","entry_date","created_at","id");--> statement-breakpoint
DROP INDEX IF EXISTS "ledger_entries_lease_id_index";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_spent_on_index" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_period_index" ON "invoices" USING btree ("period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_created_at_id_index" ON "messages" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_claims_created_at_id_index" ON "payment_claims" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_requests_created_at_id_index" ON "payment_requests" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_paid_at_id_index" ON "payments" USING btree ("paid_at","id");
