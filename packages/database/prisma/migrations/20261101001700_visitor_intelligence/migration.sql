-- Enhancement feature 15: website visitor intelligence (ADR 0029). First-party, consent-aware page tracking.
CREATE TABLE "visitor_settings" (
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "site_key" TEXT NOT NULL,
    "consent_mode" TEXT NOT NULL DEFAULT 'opt_in',
    "allowed_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "retention_days" INTEGER NOT NULL DEFAULT 180,
    "create_leads" BOOLEAN NOT NULL DEFAULT true,
    "enquiry_consent_text" TEXT,
    "high_intent_score" INTEGER NOT NULL DEFAULT 50,
    "important_pages" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "visitor_settings_pkey" PRIMARY KEY ("tenant_id")
);
CREATE UNIQUE INDEX "visitor_settings_site_key_key" ON "visitor_settings"("site_key");
ALTER TABLE "visitor_settings" ADD CONSTRAINT "visitor_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "web_visitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "engaged_seconds" INTEGER NOT NULL DEFAULT 0,
    "enquiries" INTEGER NOT NULL DEFAULT 0,
    "lead_id" UUID,
    "contact_id" UUID,
    "identified_at" TIMESTAMPTZ(3),
    "identified_via" TEXT,
    "first_touch" JSONB,
    "campaign_id" UUID,
    "intent_score" INTEGER NOT NULL DEFAULT 0,
    "high_intent_at" TIMESTAMPTZ(3),
    CONSTRAINT "web_visitors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "web_visitors_tenant_id_client_id_key" ON "web_visitors"("tenant_id", "client_id");
CREATE INDEX "web_visitors_tenant_id_last_seen_at_idx" ON "web_visitors"("tenant_id", "last_seen_at");
CREATE INDEX "web_visitors_tenant_id_lead_id_idx" ON "web_visitors"("tenant_id", "lead_id");
CREATE INDEX "web_visitors_tenant_id_contact_id_idx" ON "web_visitors"("tenant_id", "contact_id");
ALTER TABLE "web_visitors" ADD CONSTRAINT "web_visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_visitors" ADD CONSTRAINT "web_visitors_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "web_visitors" ADD CONSTRAINT "web_visitors_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "web_visitors" ADD CONSTRAINT "web_visitors_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "web_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landing_path" TEXT,
    "referrer_host" TEXT,
    "utm" JSONB,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "engaged_seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "web_sessions_tenant_id_client_id_key" ON "web_sessions"("tenant_id", "client_id");
CREATE INDEX "web_sessions_tenant_id_started_at_idx" ON "web_sessions"("tenant_id", "started_at");
CREATE INDEX "web_sessions_visitor_id_idx" ON "web_sessions"("visitor_id");
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "web_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "web_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "session_id" UUID,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "title" TEXT,
    "name" TEXT,
    "data" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "web_events_tenant_id_occurred_at_idx" ON "web_events"("tenant_id", "occurred_at");
CREATE INDEX "web_events_visitor_id_idx" ON "web_events"("visitor_id");
ALTER TABLE "web_events" ADD CONSTRAINT "web_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_events" ADD CONSTRAINT "web_events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "web_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_events" ADD CONSTRAINT "web_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "web_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visitor_settings','web_visitors','web_sessions','web_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- The public collect endpoint knows only the site key: expose just the row whose key the caller supplies, the same
-- way hosted forms resolve their token (app_form_tenant).
CREATE POLICY visitor_site_key_lookup ON visitor_settings FOR SELECT
  USING (site_key = nullif(current_setting('app.site_key', true), ''));

CREATE OR REPLACE FUNCTION app_visitor_site_tenant(p_key text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  result uuid;
BEGIN
  PERFORM set_config('app.site_key', p_key, true);
  SELECT tenant_id INTO result FROM visitor_settings WHERE site_key = p_key AND enabled;
  PERFORM set_config('app.site_key', '', true);
  RETURN result;
END
$$;

-- The worker finds workspaces with tracking settings (tenant ids only) to apply each one's retention period.
CREATE POLICY worker_scan ON visitor_settings FOR SELECT USING (app_worker_scan());

ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['visitors:read']))
  WHERE is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['visitors:manage']))
  WHERE is_system AND key IN ('owner','admin','manager');
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
