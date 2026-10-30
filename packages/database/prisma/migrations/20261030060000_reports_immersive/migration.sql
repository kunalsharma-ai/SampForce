-- CreateEnum
CREATE TYPE "ReportVisibility" AS ENUM ('PRIVATE', 'WORKSPACE');

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "definition" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_tenant_id_created_by_id_idx" ON "reports"("tenant_id", "created_by_id");

-- CreateIndex
CREATE INDEX "dashboards_tenant_id_created_by_id_idx" ON "dashboards"("tenant_id", "created_by_id");

-- CreateIndex
CREATE INDEX "deal_stage_events_tenant_id_pipeline_id_occurred_at_idx" ON "deal_stage_events"("tenant_id", "pipeline_id", "occurred_at");

-- CreateIndex
CREATE INDEX "deal_stage_events_opportunity_id_occurred_at_idx" ON "deal_stage_events"("opportunity_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_events" ADD CONSTRAINT "deal_stage_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_events" ADD CONSTRAINT "deal_stage_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Back-fill stage history from what was already recorded ─────
-- Before this table existed, moves were recorded only in the audit log, by stage name. Each deal gets a first event
-- at its creation time (the stage it left in its earliest recorded move, or its current stage), then one event per
-- logged move whose stage names still match a single stage of the deal's pipeline. All are marked reconstructed.
ALTER TABLE opportunities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE _moves ON COMMIT DROP AS
SELECT a.tenant_id, o.id AS opportunity_id, o.pipeline_id, a.created_at, a.actor_user_id,
       (SELECT s.id FROM pipeline_stages s WHERE s.pipeline_id = o.pipeline_id AND s.name = a.metadata->>'from'
         AND (SELECT count(*) FROM pipeline_stages s2 WHERE s2.pipeline_id = o.pipeline_id AND s2.name = s.name) = 1) AS from_stage_id,
       (SELECT s.id FROM pipeline_stages s WHERE s.pipeline_id = o.pipeline_id AND s.name = a.metadata->>'to'
         AND (SELECT count(*) FROM pipeline_stages s2 WHERE s2.pipeline_id = o.pipeline_id AND s2.name = s.name) = 1) AS to_stage_id
FROM audit_logs a
JOIN opportunities o ON o.id::text = a.entity_id AND o.tenant_id = a.tenant_id
WHERE a.action = 'deal.stage_changed' AND a.entity_type = 'deal';

INSERT INTO deal_stage_events (tenant_id, opportunity_id, pipeline_id, from_stage_id, to_stage_id, actor_user_id, reconstructed, occurred_at)
SELECT o.tenant_id, o.id, o.pipeline_id, NULL,
       COALESCE((SELECT m.from_stage_id FROM _moves m WHERE m.opportunity_id = o.id ORDER BY m.created_at LIMIT 1), o.stage_id),
       NULL, true, o.created_at
FROM opportunities o;

INSERT INTO deal_stage_events (tenant_id, opportunity_id, pipeline_id, from_stage_id, to_stage_id, actor_user_id, reconstructed, occurred_at)
SELECT tenant_id, opportunity_id, pipeline_id, from_stage_id, to_stage_id, actor_user_id, true, created_at
FROM _moves WHERE to_stage_id IS NOT NULL;

ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages FORCE ROW LEVEL SECURITY;

-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reports','dashboards','deal_stage_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Stage history is evidence for flow and replay views: append-only for the application role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    REVOKE UPDATE ON deal_stage_events FROM dealflow_app;
  END IF;
END $$;

-- ───── New permissions on existing system roles ─────
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['reports:read'])) WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['reports:write']))
  WHERE is_system AND key IN ('owner','admin','manager','member');
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['reports:manage']))
  WHERE is_system AND key IN ('owner','admin','manager');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
