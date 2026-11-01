-- Zoom workspace app: meetings scheduled from DealFlow, and their transcripts.
ALTER TYPE "AppProvider" ADD VALUE 'ZOOM';

CREATE TABLE "zoom_meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "zoom_meeting_id" TEXT NOT NULL,
    "host_email" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "join_url" TEXT NOT NULL,
    "record_to_cloud" BOOLEAN NOT NULL DEFAULT false,
    "lead_id" UUID,
    "contact_id" UUID,
    "deal_id" UUID,
    "created_by_id" UUID NOT NULL,
    "activity_id" UUID,
    "meeting_record_id" UUID,
    "transcript_status" TEXT NOT NULL DEFAULT 'none',
    "transcript_error" TEXT,
    "transcript_source" TEXT,
    "transcript_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zoom_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "zoom_meetings_tenant_id_starts_at_idx" ON "zoom_meetings"("tenant_id", "starts_at");
CREATE INDEX "zoom_meetings_transcript_status_idx" ON "zoom_meetings"("transcript_status");
CREATE UNIQUE INDEX "zoom_meetings_tenant_id_zoom_meeting_id_key" ON "zoom_meetings"("tenant_id", "zoom_meeting_id");
ALTER TABLE "zoom_meetings" ADD CONSTRAINT "zoom_meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zoom_meetings" ADD CONSTRAINT "zoom_meetings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE zoom_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON zoom_meetings USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
-- The worker finds transcripts Zoom has delivered across workspaces; the import itself runs in the workspace's context.
CREATE POLICY worker_scan ON zoom_meetings FOR SELECT USING (app_worker_scan());
