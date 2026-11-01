-- Workspace apps (Slack first): one connection per app per workspace, plus a log of what was sent or received.
CREATE TYPE "AppProvider" AS ENUM ('SLACK');

CREATE TABLE "app_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" "AppProvider" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "scopes" TEXT[],
    "credentials_encrypted" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_error" TEXT,
    "last_used_at" TIMESTAMPTZ(3),
    "connected_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "app_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID,
    "provider" "AppProvider" NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "external_id" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "entity_type" TEXT,
    "entity_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_connections_provider_external_account_id_idx" ON "app_connections"("provider", "external_account_id");
CREATE UNIQUE INDEX "app_connections_tenant_id_provider_key" ON "app_connections"("tenant_id", "provider");
CREATE INDEX "app_events_tenant_id_provider_created_at_idx" ON "app_events"("tenant_id", "provider", "created_at" DESC);

ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "app_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_connections','app_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Inbound provider events (signed webhooks) carry the provider's account id, not a DealFlow tenant. A transaction that
-- sets app.app_provider and app.app_account may read just the matching connection rows, to learn which tenant they are.
CREATE POLICY provider_lookup ON app_connections FOR SELECT USING (
  provider::text = current_setting('app.app_provider', true)
  AND external_account_id = current_setting('app.app_account', true)
);
