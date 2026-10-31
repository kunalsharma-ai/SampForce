-- Email finder lookups: per-person history and the daily limit. Tenant-isolated like every tenant table.
CREATE TABLE "finder_lookups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "domain" TEXT,
    "person" TEXT,
    "found" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finder_lookups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finder_lookups_tenant_id_user_id_created_at_idx" ON "finder_lookups"("tenant_id", "user_id", "created_at");
ALTER TABLE "finder_lookups" ADD CONSTRAINT "finder_lookups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finder_lookups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finder_lookups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "finder_lookups" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
