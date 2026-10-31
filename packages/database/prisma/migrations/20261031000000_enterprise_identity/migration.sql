-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "auth_method" TEXT NOT NULL DEFAULT 'password',
ADD COLUMN     "sso_tenant_id" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "require_mfa" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_last_step" BIGINT,
ADD COLUMN     "mfa_secret_enc" TEXT;

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "login_slug" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jit_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "default_role_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "last_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_by_id" UUID,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_tenant_id_key" ON "sso_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_login_slug_key" ON "sso_connections"("login_slug");

-- CreateIndex
CREATE INDEX "sso_identities_tenant_id_user_id_idx" ON "sso_identities"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_identities_connection_id_subject_key" ON "sso_identities"("connection_id", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "scim_tokens_tenant_id_idx" ON "scim_tokens"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_external_id_key" ON "memberships"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_identities" ADD CONSTRAINT "sso_identities_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "sso_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───── Row-level security ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sso_connections','sso_identities','scim_tokens']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Sign-in pages have no tenant context. As with invitations, narrow SELECT policies expose exactly the
-- row the caller names in a transaction-local setting: an enabled SSO connection by its login name, or
-- a live SCIM token by the hash of the token (knowing the hash requires knowing the token).
CREATE POLICY sso_login_lookup ON "sso_connections" FOR SELECT
  USING (enabled AND login_slug = nullif(current_setting('app.sso_login_slug', true), ''));
CREATE POLICY scim_token_lookup ON "scim_tokens" FOR SELECT
  USING (revoked_at IS NULL AND token_hash = nullif(current_setting('app.scim_token_hash', true), ''));

-- ───── Plans: single sign-on and SCIM are Enterprise features (proposal, see PRICING_STRATEGY) ─────
UPDATE plans SET entitlements = entitlements || jsonb_build_object('sso', code IN ('enterprise','enterprise_plus'));
