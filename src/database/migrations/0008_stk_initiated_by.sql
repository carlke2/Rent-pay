ALTER TABLE "payment_requests" ADD COLUMN "initiated_by" text NOT NULL DEFAULT 'tenant';
