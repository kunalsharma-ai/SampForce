-- What an offline invoice is for, applied to the subscription when an operator records the payment.
ALTER TABLE "invoices" ADD COLUMN "plan_code" TEXT,
  ADD COLUMN "billing_interval" "BillingInterval",
  ADD COLUMN "seats" INTEGER,
  ADD COLUMN "requested_by_id" UUID,
  ADD COLUMN "payment_reference" TEXT;

-- A workspace has at most one open offline invoice at a time.
CREATE UNIQUE INDEX "invoices_one_open_offline" ON "invoices" ("tenant_id") WHERE provider = 'OFFLINE' AND status = 'OPEN';

-- Invoice numbers (DF-000001, ...), shared by all workspaces so a number identifies one invoice.
CREATE SEQUENCE "offline_invoice_number_seq";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE "offline_invoice_number_seq" TO dealflow_app;
  END IF;
END $$;
