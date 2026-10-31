-- Enhancement feature 13: daily customer health history, for churn-risk trends (ADR 0027).
CREATE TABLE "company_health_daily" (
    "company_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "tenant_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    CONSTRAINT "company_health_daily_pkey" PRIMARY KEY ("company_id", "day")
);
CREATE INDEX "company_health_daily_tenant_id_day_idx" ON "company_health_daily"("tenant_id", "day");
ALTER TABLE "company_health_daily" ADD CONSTRAINT "company_health_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_health_daily" ADD CONSTRAINT "company_health_daily_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_health_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_health_daily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_health_daily" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
