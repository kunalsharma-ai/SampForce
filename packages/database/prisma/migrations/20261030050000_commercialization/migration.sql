-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('NONE', 'STRIPE', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "OperatorStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'UNPAID';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "past_due_since" TIMESTAMPTZ(3),
ADD COLUMN     "provider" "BillingProvider" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "provider_customer_id" TEXT,
ADD COLUMN     "provider_subscription_id" TEXT,
ADD COLUMN     "trial_used_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "onboarding_dismissed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "provider_invoice_id" TEXT NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "amount_paid_cents" INTEGER NOT NULL DEFAULT 0,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "hosted_url" TEXT,
    "pdf_url" TEXT,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_operators" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "OperatorRole" NOT NULL DEFAULT 'SUPPORT',
    "status" "OperatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operator_id" UUID,
    "action" TEXT NOT NULL,
    "target_tenant_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_tenant_id_issued_at_idx" ON "invoices"("tenant_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_provider_invoice_id_key" ON "invoices"("provider", "provider_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_provider_provider_event_id_key" ON "billing_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "support_grants_tenant_id_expires_at_idx" ON "support_grants"("tenant_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_operators_email_key" ON "platform_operators"("email");

-- CreateIndex
CREATE INDEX "platform_audit_logs_target_tenant_id_created_at_idx" ON "platform_audit_logs"("target_tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_provider_provider_customer_id_idx" ON "subscriptions"("provider", "provider_customer_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_grants" ADD CONSTRAINT "support_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "platform_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','billing_events','support_grants']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Billing webhooks name a provider customer or subscription, not a workspace. As with form tokens, a narrow
-- policy exposes only the subscription row whose provider reference the caller supplies.
CREATE POLICY billing_ref_lookup ON subscriptions FOR SELECT
  USING (nullif(current_setting('app.billing_ref', true), '') IN (provider_customer_id, provider_subscription_id));

CREATE OR REPLACE FUNCTION app_billing_tenant(p_ref text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result uuid;
BEGIN
  PERFORM set_config('app.billing_ref', p_ref, true);
  SELECT tenant_id INTO result FROM subscriptions WHERE p_ref IN (provider_customer_id, provider_subscription_id) LIMIT 1;
  PERFORM set_config('app.billing_ref', '', true);
  RETURN result;
END
$$;

-- The operator console lists workspaces with their plan and member counts. It reads these three tables (and
-- invoices) across tenants under a transaction-local flag, like the worker; it never reads CRM tables this way.
CREATE OR REPLACE FUNCTION app_operator_scan() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.operator_scan', true) = 'on' $$;
CREATE POLICY operator_scan ON tenants FOR SELECT USING (app_operator_scan());
CREATE POLICY operator_scan ON subscriptions FOR SELECT USING (app_operator_scan());
CREATE POLICY operator_scan ON memberships FOR SELECT USING (app_operator_scan());
CREATE POLICY operator_scan ON invoices FOR SELECT USING (app_operator_scan());

-- Operator actions are evidence: append-only for the application role.
REVOKE UPDATE, DELETE ON platform_audit_logs FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    REVOKE UPDATE, DELETE ON platform_audit_logs FROM dealflow_app;
  END IF;
END $$;

-- Custom roles become a plan entitlement (Professional and above).
UPDATE plans SET entitlements = entitlements || jsonb_build_object('customRoles', code IN ('professional','business','enterprise','enterprise_plus'));

-- Trial expiry and dunning: the worker finds due subscriptions across tenants, then acts in each tenant's context.
CREATE POLICY worker_scan ON subscriptions FOR SELECT USING (app_worker_scan());
-- The tenant list shows whether a workspace has granted support access (the grant row only, never what it unlocks).
CREATE POLICY operator_scan ON support_grants FOR SELECT USING (app_operator_scan());
