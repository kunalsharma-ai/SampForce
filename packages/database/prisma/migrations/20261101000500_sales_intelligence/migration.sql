-- Enhancement Phase 1: deal health monitor and next best action decisions (accepted, dismissed, snoozed). Tenant-isolated like every tenant table.
CREATE TABLE "deal_health_scores" (
    "deal_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "health" INTEGER NOT NULL,
    "risk" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "alerted_at" TIMESTAMPTZ(3),
    CONSTRAINT "deal_health_scores_pkey" PRIMARY KEY ("deal_id"),
    CONSTRAINT "deal_health_scores_risk_check" CHECK ("risk" IN ('low', 'medium', 'high')),
    CONSTRAINT "deal_health_scores_health_check" CHECK ("health" BETWEEN 0 AND 100)
);
CREATE INDEX "deal_health_scores_tenant_id_risk_idx" ON "deal_health_scores"("tenant_id", "risk");
ALTER TABLE "deal_health_scores" ADD CONSTRAINT "deal_health_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_health_scores" ADD CONSTRAINT "deal_health_scores_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deal_health_daily" (
    "deal_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "tenant_id" UUID NOT NULL,
    "health" INTEGER NOT NULL,
    "risk" TEXT NOT NULL,
    CONSTRAINT "deal_health_daily_pkey" PRIMARY KEY ("deal_id", "day")
);
CREATE INDEX "deal_health_daily_tenant_id_day_idx" ON "deal_health_daily"("tenant_id", "day");
ALTER TABLE "deal_health_daily" ADD CONSTRAINT "deal_health_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_health_daily" ADD CONSTRAINT "deal_health_daily_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "next_action_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "until" TIMESTAMPTZ(3),
    "task_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "next_action_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "next_action_decisions_decision_check" CHECK ("decision" IN ('accepted', 'dismissed', 'snoozed'))
);
CREATE UNIQUE INDEX "next_action_decisions_tenant_id_user_id_key_key" ON "next_action_decisions"("tenant_id", "user_id", "key");
CREATE INDEX "next_action_decisions_tenant_id_user_id_created_at_idx" ON "next_action_decisions"("tenant_id", "user_id", "created_at");
ALTER TABLE "next_action_decisions" ADD CONSTRAINT "next_action_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deal_health_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_health_scores" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_health_scores" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE "deal_health_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_health_daily" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_health_daily" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
-- Decisions are personal: only the person who made them sees them (like notifications).
ALTER TABLE "next_action_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "next_action_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "next_action_decisions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY own_decisions ON "next_action_decisions" AS RESTRICTIVE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
