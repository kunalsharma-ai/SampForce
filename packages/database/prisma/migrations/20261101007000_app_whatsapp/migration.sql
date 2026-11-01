-- AlterEnum
ALTER TYPE "AppProvider" ADD VALUE 'WHATSAPP';

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "contact_id" UUID,
    "direction" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "wa_message_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_name" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_by_id" UUID,
    "source" TEXT NOT NULL,
    "status_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recorded_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenant_id_contact_id_created_at_idx" ON "whatsapp_messages"("tenant_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenant_id_phone_created_at_idx" ON "whatsapp_messages"("tenant_id", "phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_tenant_id_wa_message_id_key" ON "whatsapp_messages"("tenant_id", "wa_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_consents_tenant_id_contact_id_created_at_idx" ON "whatsapp_consents"("tenant_id", "contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_consents" ADD CONSTRAINT "whatsapp_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_consents" ADD CONSTRAINT "whatsapp_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: tenant isolation, as for every tenant table.
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_messages USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE whatsapp_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_consents USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
