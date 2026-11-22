ALTER TABLE "receipts" ADD COLUMN "short_code" text;
ALTER TABLE "pay_links" ADD COLUMN "short_code" text;
CREATE UNIQUE INDEX "receipts_short_code_unique" ON "receipts" ("short_code") WHERE "short_code" IS NOT NULL;
CREATE UNIQUE INDEX "pay_links_short_code_unique" ON "pay_links" ("short_code") WHERE "short_code" IS NOT NULL;
