-- Enhancement feature 14: sales gamification (ADR 0028). Points are computed from CRM records with these rules.
CREATE TABLE "gamification_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'everyone',
    "rules" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gamification_settings_pkey" PRIMARY KEY ("tenant_id")
);
ALTER TABLE "gamification_settings" ADD CONSTRAINT "gamification_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "gamification_badges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'medal',
    "metric" TEXT NOT NULL,
    "threshold" DECIMAL(18,2) NOT NULL,
    "window" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gamification_badges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gamification_badges_tenant_id_name_key" ON "gamification_badges"("tenant_id", "name");
ALTER TABLE "gamification_badges" ADD CONSTRAINT "gamification_badges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "gamification_awards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "awarded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gamification_awards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gamification_awards_badge_id_user_id_period_key" ON "gamification_awards"("badge_id", "user_id", "period");
CREATE INDEX "gamification_awards_tenant_id_user_id_idx" ON "gamification_awards"("tenant_id", "user_id");
ALTER TABLE "gamification_awards" ADD CONSTRAINT "gamification_awards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gamification_awards" ADD CONSTRAINT "gamification_awards_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "gamification_badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gamification_awards" ADD CONSTRAINT "gamification_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "gamification_competitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "goal" DECIMAL(18,2),
    "reward" TEXT,
    "team_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "rules" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    CONSTRAINT "gamification_competitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gamification_competitions_tenant_id_end_date_idx" ON "gamification_competitions"("tenant_id", "end_date");
ALTER TABLE "gamification_competitions" ADD CONSTRAINT "gamification_competitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gamification_settings','gamification_badges','gamification_awards','gamification_competitions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- The worker finds workspaces with gamification on (tenant ids only), then awards badges inside each tenant's context.
CREATE POLICY worker_scan ON gamification_settings USING (app_worker_scan()) WITH CHECK (app_worker_scan());

-- New permissions for existing system roles: everyone can read; owners, admins and sales managers manage.
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['gamification:read']))
  WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['gamification:manage']))
  WHERE is_system AND key IN ('owner','admin','manager');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
