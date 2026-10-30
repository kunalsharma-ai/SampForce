-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- DropIndex
DROP INDEX "opportunities_search_trgm";

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "actor_user_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger_type" TEXT NOT NULL,
    "active_version_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "simulation" BOOLEAN NOT NULL DEFAULT false,
    "current_node" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "resume_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "execution_id" UUID,
    "node_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "permission" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "event_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret_encrypted" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "disabled_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_code" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "account_email" TEXT NOT NULL,
    "scopes" TEXT[],
    "credentials_encrypted" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "mail_cursor" TEXT,
    "calendar_cursor" TEXT,
    "last_sync_at" TIMESTAMPTZ(3),
    "next_sync_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "direction" "EmailDirection" NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "body_text" TEXT,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "contact_id" UUID,
    "lead_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "attendees" TEXT[],
    "organizer" TEXT,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "contact_ids" UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_events_processed_at_created_at_idx" ON "domain_events"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "domain_events_tenant_id_created_at_idx" ON "domain_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_status_trigger_type_idx" ON "workflows"("tenant_id", "status", "trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_id_version_key" ON "workflow_versions"("workflow_id", "version");

-- CreateIndex
CREATE INDEX "workflow_executions_status_resume_at_idx" ON "workflow_executions"("status", "resume_at");

-- CreateIndex
CREATE INDEX "workflow_executions_tenant_id_workflow_id_started_at_idx" ON "workflow_executions"("tenant_id", "workflow_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_version_id_event_id_key" ON "workflow_executions"("version_id", "event_id");

-- CreateIndex
CREATE INDEX "workflow_steps_execution_id_started_at_idx" ON "workflow_steps"("execution_id", "started_at");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_created_at_idx" ON "approval_requests"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_created_at_idx" ON "notifications"("tenant_id", "user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_event_id_type_key" ON "notifications"("user_id", "event_id", "type");

-- CreateIndex
CREATE INDEX "webhooks_tenant_id_active_idx" ON "webhooks"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_id_event_id_key" ON "webhook_deliveries"("webhook_id", "event_id");

-- CreateIndex
CREATE INDEX "integration_connections_status_next_sync_at_idx" ON "integration_connections"("status", "next_sync_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_tenant_id_user_id_provider_key" ON "integration_connections"("tenant_id", "user_id", "provider");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_contact_id_sent_at_idx" ON "email_messages"("tenant_id", "contact_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_lead_id_sent_at_idx" ON "email_messages"("tenant_id", "lead_id", "sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_connection_id_provider_message_id_key" ON "email_messages"("connection_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_starts_at_idx" ON "meetings"("tenant_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_connection_id_provider_event_id_key" ON "meetings"("connection_id", "provider_event_id");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['domain_events','workflows','workflow_versions','workflow_executions','workflow_steps',
    'approval_requests','notifications','webhooks','webhook_deliveries','integration_connections','email_messages','meetings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Notifications are personal: inside a tenant, a user sees only their own.
CREATE POLICY own_notifications ON notifications AS RESTRICTIVE FOR SELECT
  USING (user_id = app_current_user() OR current_setting('app.worker_scan', true) = 'on');

-- ───── Worker queue scan ─────
-- The background worker must find due work across tenants. Only the queue tables get this narrow
-- policy, which applies when the worker sets app.worker_scan for a claim transaction. Claims read
-- and lock ids and tenant ids; each item is then processed inside its own tenant context.
CREATE OR REPLACE FUNCTION app_worker_scan() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.worker_scan', true) = 'on' $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['domain_events','workflow_executions','webhook_deliveries','integration_connections','approval_requests']
  LOOP
    EXECUTE format('CREATE POLICY worker_scan ON %I USING (app_worker_scan()) WITH CHECK (app_worker_scan())', t);
  END LOOP;
END $$;

-- Outbox rows are immutable apart from processing bookkeeping; no deletes from the app role.
REVOKE DELETE ON domain_events FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealflow_app') THEN
    REVOKE DELETE ON domain_events FROM dealflow_app;
  END IF;
END $$;
