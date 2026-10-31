-- Deployment-wide settings edited in the operator console, e.g. the payment instructions on offline invoices.
-- Not workspace data, so no tenant_id and no row-level security; only the operator API writes it.
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);
