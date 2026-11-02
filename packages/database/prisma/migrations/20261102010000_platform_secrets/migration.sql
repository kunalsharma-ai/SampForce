-- Provider keys entered in the operator console (ADR 0051). Deployment-wide, like platform_settings: no tenant_id and
-- no row-level security; only the operator API writes it. value_enc is AES-256-GCM sealed with ENCRYPTION_KEY.
CREATE TABLE "platform_secrets" (
    "name" TEXT NOT NULL,
    "value_enc" TEXT NOT NULL,
    "hint" TEXT,
    "fingerprint" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_secrets_pkey" PRIMARY KEY ("name"),
    CONSTRAINT "platform_secrets_name_shape" CHECK ("name" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT "platform_secrets_sealed_shape" CHECK ("value_enc" LIKE 'v1.%')
);
