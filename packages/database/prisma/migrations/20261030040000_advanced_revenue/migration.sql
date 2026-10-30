-- CreateEnum
CREATE TYPE "MarketingConsent" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EscalationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "consent_source" TEXT,
ADD COLUMN     "consent_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "marketing_consent" "MarketingConsent" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "consent_source" TEXT,
ADD COLUMN     "consent_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "marketing_consent" "MarketingConsent" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "commercial_settings" (
    "tenant_id" UUID NOT NULL,
    "discount_approval_threshold" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "quote_validity_days" INTEGER NOT NULL DEFAULT 30,
    "quote_terms" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commercial_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_book_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "price_book_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_book_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(6,3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "opportunity_id" UUID NOT NULL,
    "price_book_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "valid_until" DATE,
    "notes" TEXT,
    "terms" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "approval_id" UUID,
    "created_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate_id" UUID,
    "tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(18,2) NOT NULL,
    "tax_total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID,
    "opportunity_id" UUID,
    "quote_id" UUID,
    "owner_id" UUID,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "renewal_notice_days" INTEGER NOT NULL DEFAULT 30,
    "signature_method" TEXT,
    "signed_by" TEXT,
    "signed_at" DATE,
    "terms" TEXT,
    "renewed_from_id" UUID,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "terminated_at" TIMESTAMPTZ(3),
    "termination_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE,
    "end_date" DATE,
    "budget" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL,
    "utm_campaign" TEXT,
    "owner_id" UUID,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "public_token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "fields" JSONB NOT NULL,
    "consent_text" TEXT,
    "success_message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web_form',
    "campaign_id" UUID,
    "owner_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "lead_id" UUID,
    "data" JSONB NOT NULL,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effective_date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contract_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "EscalationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" UUID,
    "opened_by_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_health" (
    "company_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "alerted_at" TIMESTAMPTZ(3),

    CONSTRAINT "company_health_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "price_books_tenant_id_name_key" ON "price_books"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "price_book_entries_price_book_id_product_id_key" ON "price_book_entries"("price_book_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_tenant_id_name_key" ON "tax_rates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_opportunity_id_idx" ON "quotes"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_status_is_latest_idx" ON "quotes"("tenant_id", "status", "is_latest");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_number_version_key" ON "quotes"("tenant_id", "number", "version");

-- CreateIndex
CREATE INDEX "quote_lines_quote_id_position_idx" ON "quote_lines"("quote_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_renewed_from_id_key" ON "contracts"("renewed_from_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_status_end_date_idx" ON "contracts"("tenant_id", "status", "end_date");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_company_id_idx" ON "contracts"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_number_key" ON "contracts"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tenant_id_name_key" ON "campaigns"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "segments_tenant_id_name_key" ON "segments"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lead_forms_public_token_key" ON "lead_forms"("public_token");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_created_at_idx" ON "form_submissions"("form_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "form_submissions_tenant_id_ip_hash_created_at_idx" ON "form_submissions"("tenant_id", "ip_hash", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_tenant_id_currency_effective_date_key" ON "exchange_rates"("tenant_id", "currency", "effective_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_tenant_id_period_user_id_key" ON "sales_targets"("tenant_id", "period", "user_id");

-- CreateIndex
CREATE INDEX "escalations_tenant_id_status_severity_idx" ON "escalations"("tenant_id", "status", "severity");

-- CreateIndex
CREATE INDEX "escalations_tenant_id_company_id_idx" ON "escalations"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "company_health_tenant_id_band_idx" ON "company_health"("tenant_id", "band");

-- CreateIndex
CREATE INDEX "leads_tenant_id_campaign_id_idx" ON "leads"("tenant_id", "campaign_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_settings" ADD CONSTRAINT "commercial_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "price_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "lead_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_health" ADD CONSTRAINT "company_health_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_health" ADD CONSTRAINT "company_health_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commercial_settings','products','price_books','price_book_entries','tax_rates','quotes','quote_lines',
                           'contracts','campaigns','segments','lead_forms','form_submissions','exchange_rates','sales_targets',
                           'escalations','company_health']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Renewal reminders and churn alerts: the worker finds active contracts across tenants (ids and tenant ids
-- only, in a claim transaction) and then processes each tenant inside its own context, as for queue tables.
CREATE POLICY worker_scan ON contracts FOR SELECT USING (app_worker_scan());

-- Public form lookup by token, without a tenant context. Same pattern as invitations: a narrow policy
-- exposes only the row whose token the caller supplies in a transaction-local setting.
CREATE POLICY lead_form_token_lookup ON lead_forms FOR SELECT
  USING (public_token = nullif(current_setting('app.form_token', true), ''));

CREATE OR REPLACE FUNCTION app_form_tenant(p_token text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result uuid;
BEGIN
  PERFORM set_config('app.form_token', p_token, true);
  SELECT tenant_id INTO result FROM lead_forms WHERE public_token = p_token AND active;
  PERFORM set_config('app.form_token', '', true);
  RETURN result;
END
$$;

-- Form submissions are evidence of consent: the app role may not rewrite them.
REVOKE UPDATE ON form_submissions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    REVOKE UPDATE ON form_submissions FROM dealflow_app;
  END IF;
END $$;

-- ───── New permissions on existing system roles ─────
-- roles has FORCE RLS; the migration owner lifts it for this one update and restores it.
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['quotes:read','contracts:read','marketing:read','success:read']))
  WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['quotes:write','contracts:write','success:write']))
  WHERE is_system AND key IN ('owner','admin','manager','member');
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['catalog:manage','quotes:approve','marketing:manage']))
  WHERE is_system AND key IN ('owner','admin','manager');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
