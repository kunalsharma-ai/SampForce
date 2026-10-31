-- CreateTable
CREATE TABLE "prospect_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "assignee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prospect_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "email_status" TEXT,
    "email_checked_at" TIMESTAMPTZ(3),
    "title" TEXT,
    "company_name" TEXT,
    "domain" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "company_size" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "lead_id" UUID,
    "contact_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_outreach" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prospect_settings" (
    "tenant_id" UUID NOT NULL,
    "daily_limit" INTEGER NOT NULL,
    "user_limits" JSONB NOT NULL DEFAULT '{}',
    "apollo_live_at" TIMESTAMPTZ(3),
    "hunter_live_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_lists_tenant_id_name_key" ON "prospect_lists"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "prospects_tenant_id_list_id_created_at_idx" ON "prospects"("tenant_id", "list_id", "created_at");

-- CreateIndex
CREATE INDEX "prospects_list_id_email_idx" ON "prospects"("list_id", "email");

-- CreateIndex
CREATE INDEX "prospects_tenant_id_email_idx" ON "prospects"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_outreach_list_id_sequence_id_key" ON "prospect_outreach"("list_id", "sequence_id");

-- CreateIndex
CREATE INDEX "prospect_imports_tenant_id_created_at_idx" ON "prospect_imports"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_usage_tenant_id_user_id_created_at_idx" ON "provider_usage"("tenant_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "prospect_lists" ADD CONSTRAINT "prospect_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "prospect_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_outreach" ADD CONSTRAINT "prospect_outreach_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_outreach" ADD CONSTRAINT "prospect_outreach_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "prospect_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_outreach" ADD CONSTRAINT "prospect_outreach_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_imports" ADD CONSTRAINT "prospect_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_imports" ADD CONSTRAINT "prospect_imports_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "prospect_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_settings" ADD CONSTRAINT "prospect_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prospect_lists','prospects','prospect_outreach','prospect_imports','provider_usage','prospect_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- The worker clears parsed import files nobody finished mapping (tenant ids only).
CREATE POLICY worker_scan ON prospect_imports FOR SELECT USING (app_worker_scan());

ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['prospects:read']))
  WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['prospects:write','prospects:search']))
  WHERE is_system AND key IN ('owner','admin','manager','member');
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['prospects:export','prospects:manage']))
  WHERE is_system AND key IN ('owner','admin','manager');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

