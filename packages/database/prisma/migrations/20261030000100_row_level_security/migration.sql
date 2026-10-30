-- Row-level security for tenant isolation.
-- The runtime role (dealflow_app) has no BYPASSRLS. FORCE makes the table owner obey the
-- policies too, so a misconfigured connection string fails closed rather than open.
-- The API sets app.tenant_id / app.user_id per transaction via set_config(..., true).

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "teams"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "team_members"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "companies"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contacts"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leads"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipelines"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipeline_stages"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "opportunities"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activities"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tasks"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Memberships: visible inside the active tenant, and a user can always list their own
-- memberships (needed to choose a workspace at sign-in). Writes are tenant-scoped only.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON "memberships" FOR SELECT
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user());
CREATE POLICY membership_write ON "memberships" FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY membership_update ON "memberships" FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY membership_delete ON "memberships" FOR DELETE USING (tenant_id = app_current_tenant());

-- Roles: tenant-scoped, plus the roles attached to the current user's own memberships.
DROP POLICY tenant_isolation ON "roles";
CREATE POLICY role_read ON "roles" FOR SELECT
  USING (tenant_id = app_current_tenant()
         OR id IN (SELECT role_id FROM memberships WHERE user_id = app_current_user()));
CREATE POLICY role_write ON "roles" FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY role_update ON "roles" FOR UPDATE
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY role_delete ON "roles" FOR DELETE USING (tenant_id = app_current_tenant());

-- Tenants: the active tenant, plus tenants the current user belongs to (names for the switcher).
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "tenants" FOR SELECT
  USING (id = app_current_tenant()
         OR id IN (SELECT tenant_id FROM memberships WHERE user_id = app_current_user()));
CREATE POLICY tenant_insert ON "tenants" FOR INSERT WITH CHECK (id = app_current_tenant());
CREATE POLICY tenant_update ON "tenants" FOR UPDATE
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

-- Audit logs are append-only for the application.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM dealflow_app;
    REVOKE DELETE ON "tenants" FROM dealflow_app;
  END IF;
END $$;

-- Proposed launch plans (docs/PRICING_STRATEGY.md). Prices in USD cents; NULL = custom quote.
INSERT INTO "plans" (code, name, monthly_price_cents, annual_monthly_price_cents, entitlements, is_public, updated_at) VALUES
  ('free',            'DealFlow Free',            0,    0,    '{"maxUsers":2,"maxPipelines":1,"monthlyAiCredits":50,"automationRunsPerMonth":500,"apiAccess":false}', true, now()),
  ('launch',          'DealFlow Launch',          800,  600,  '{"maxUsers":null,"maxPipelines":3,"monthlyAiCredits":200,"automationRunsPerMonth":2000,"apiAccess":false}', true, now()),
  ('growth',          'DealFlow Growth',          1500, 1200, '{"maxUsers":null,"maxPipelines":10,"monthlyAiCredits":500,"automationRunsPerMonth":10000,"apiAccess":true}', true, now()),
  ('professional',    'DealFlow Professional',    2900, 2300, '{"maxUsers":null,"maxPipelines":25,"monthlyAiCredits":1000,"automationRunsPerMonth":50000,"apiAccess":true}', true, now()),
  ('business',        'DealFlow Business',        4900, 3900, '{"maxUsers":null,"maxPipelines":50,"monthlyAiCredits":2000,"automationRunsPerMonth":150000,"apiAccess":true}', true, now()),
  ('enterprise',      'DealFlow Enterprise',      7900, 6500, '{"maxUsers":null,"maxPipelines":null,"monthlyAiCredits":3000,"automationRunsPerMonth":500000,"apiAccess":true}', true, now()),
  ('enterprise_plus', 'DealFlow Enterprise Plus', NULL, NULL, '{"maxUsers":null,"maxPipelines":null,"monthlyAiCredits":3000,"automationRunsPerMonth":1000000,"apiAccess":true}', false, now())
ON CONFLICT (code) DO NOTHING;
