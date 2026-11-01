-- AlterEnum
ALTER TYPE "AppProvider" ADD VALUE 'TWILIO';

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "contact_id" UUID,
    "direction" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "twilio_sid" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_by_id" UUID,
    "source" TEXT NOT NULL,
    "status_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recorded_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_messages_tenant_id_phone_created_at_idx" ON "sms_messages"("tenant_id", "phone", "created_at");

-- CreateIndex
CREATE INDEX "sms_messages_tenant_id_contact_id_created_at_idx" ON "sms_messages"("tenant_id", "contact_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_tenant_id_twilio_sid_key" ON "sms_messages"("tenant_id", "twilio_sid");

-- CreateIndex
CREATE INDEX "sms_consents_tenant_id_contact_id_created_at_idx" ON "sms_consents"("tenant_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_consents_tenant_id_phone_idx" ON "sms_consents"("tenant_id", "phone");

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sms_messages USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE sms_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sms_consents USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
