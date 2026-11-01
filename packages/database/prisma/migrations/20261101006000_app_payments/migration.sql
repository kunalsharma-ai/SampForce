-- Card payments on quotes, into each workspace's own Stripe or Razorpay account.
ALTER TYPE "AppProvider" ADD VALUE 'PAYMENTS';

CREATE TABLE "quote_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "quote_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payer_email" TEXT,
    "provider_payment_id" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_payments_tenant_id_quote_id_idx" ON "quote_payments"("tenant_id", "quote_id");
ALTER TABLE "quote_payments" ADD CONSTRAINT "quote_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_payments" ADD CONSTRAINT "quote_payments_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_payments" ADD CONSTRAINT "quote_payments_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE quote_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_payments USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
