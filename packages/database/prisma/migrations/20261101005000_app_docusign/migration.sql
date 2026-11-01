-- DocuSign workspace app: contracts sent for e-signature.
ALTER TYPE "AppProvider" ADD VALUE 'DOCUSIGN';

CREATE TABLE "signature_envelopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "contract_id" UUID NOT NULL,
    "envelope_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT NOT NULL,
    "sent_by_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "declined_reason" TEXT,
    "voided_reason" TEXT,
    "last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signature_envelopes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signature_envelopes_tenant_id_contract_id_idx" ON "signature_envelopes"("tenant_id", "contract_id");
CREATE UNIQUE INDEX "signature_envelopes_tenant_id_envelope_id_key" ON "signature_envelopes"("tenant_id", "envelope_id");
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE signature_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON signature_envelopes USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
