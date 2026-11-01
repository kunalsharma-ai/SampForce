-- Personal Command Center layout per workspace, kept with the person's navigation (same RLS policy).
ALTER TABLE "workspace_navigation" ADD COLUMN "dashboard_layout" JSONB;
