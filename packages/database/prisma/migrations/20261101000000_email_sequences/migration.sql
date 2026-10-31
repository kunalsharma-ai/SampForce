-- Phase 9: email templates, sequences, enrolments, sent messages, tracking events and the do-not-email list.
-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'MOVED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('REPLIED', 'OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'BOUNCED', 'MANUAL');

-- CreateTable
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_id" UUID,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "lead_id" UUID,
    "contact_id" UUID,
    "email" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "enrolled_by_id" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "clicked_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "step_id" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "email_message_id" UUID,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_at" TIMESTAMPTZ(3),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "replied_at" TIMESTAMPTZ(3),
    "bounced_at" TIMESTAMPTZ(3),

    CONSTRAINT "sequence_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("tenant_id","email")
);

-- CreateIndex
CREATE INDEX "email_templates_tenant_id_owner_id_idx" ON "email_templates"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "sequences_tenant_id_status_idx" ON "sequences"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sequence_enrollments_status_next_run_at_idx" ON "sequence_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "sequence_enrollments_tenant_id_sequence_id_status_idx" ON "sequence_enrollments"("tenant_id", "sequence_id", "status");

-- CreateIndex
CREATE INDEX "sequence_enrollments_tenant_id_email_idx" ON "sequence_enrollments"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "sequence_enrollments_tenant_id_lead_id_idx" ON "sequence_enrollments"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "sequence_enrollments_tenant_id_contact_id_idx" ON "sequence_enrollments"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "sequence_messages_tenant_id_sender_id_sent_at_idx" ON "sequence_messages"("tenant_id", "sender_id", "sent_at");

-- CreateIndex
CREATE INDEX "sequence_messages_tenant_id_to_address_sent_at_idx" ON "sequence_messages"("tenant_id", "to_address", "sent_at");

-- CreateIndex
CREATE INDEX "sequence_messages_enrollment_id_idx" ON "sequence_messages"("enrollment_id");

-- CreateIndex
CREATE INDEX "email_events_tenant_id_message_id_idx" ON "email_events"("tenant_id", "message_id");

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_messages" ADD CONSTRAINT "sequence_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_messages" ADD CONSTRAINT "sequence_messages_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "sequence_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "sequence_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live run per address per sequence; finished runs stay for history and re-enrolment is allowed later.
CREATE UNIQUE INDEX "sequence_enrollments_live_key" ON "sequence_enrollments"("sequence_id", "email") WHERE status IN ('ACTIVE', 'PAUSED');

-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates','sequences','sequence_enrollments','sequence_messages','email_events','email_suppressions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- The worker claims due enrolments across tenants (ids and tenant ids only), then sends inside each tenant's context.
CREATE POLICY worker_scan ON sequence_enrollments USING (app_worker_scan()) WITH CHECK (app_worker_scan());

-- ───── New permissions on existing system roles ─────
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['sequences:read']))
  WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['sequences:write']))
  WHERE is_system AND key IN ('owner','admin','manager','member');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
