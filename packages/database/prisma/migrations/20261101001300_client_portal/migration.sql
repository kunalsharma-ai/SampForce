-- Enhancement feature 11: client self-service portal. Customers sign in to a portal that is separate from the CRM:
-- portal users are not workspace members and have no access to any CRM route.

CREATE TABLE portal_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  title text,
  welcome text,
  show_deals boolean NOT NULL DEFAULT true,
  show_quotes boolean NOT NULL DEFAULT true,
  show_contracts boolean NOT NULL DEFAULT true,
  show_tasks boolean NOT NULL DEFAULT true,
  show_documents boolean NOT NULL DEFAULT true,
  allow_requests boolean NOT NULL DEFAULT true,
  allow_messages boolean NOT NULL DEFAULT true,
  allow_uploads boolean NOT NULL DEFAULT true,
  allow_approvals boolean NOT NULL DEFAULT false,
  updated_by_id uuid,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON portal_settings USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
-- The sign-in page knows only the portal's public name. This narrow policy lets it find an enabled portal by that
-- name, and nothing else, without a tenant context (the same pattern as single sign-on).
CREATE POLICY portal_slug_lookup ON portal_settings FOR SELECT USING (enabled AND slug = current_setting('app.portal_slug', true));

CREATE TABLE portal_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'approver')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  password_hash text,
  invite_token_hash text,
  invite_expires_at timestamptz(3),
  reset_token_hash text,
  reset_expires_at timestamptz(3),
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz(3),
  last_login_at timestamptz(3),
  updates_seen_at timestamptz(3),
  created_by_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX portal_users_company_idx ON portal_users (tenant_id, company_id);
CREATE INDEX portal_users_invite_idx ON portal_users (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
CREATE INDEX portal_users_reset_idx ON portal_users (reset_token_hash) WHERE reset_token_hash IS NOT NULL;

CREATE TABLE portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_user_id uuid NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  ip text,
  user_agent text
);
CREATE INDEX portal_sessions_user_idx ON portal_sessions (portal_user_id);

CREATE TABLE portal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  portal_user_id uuid REFERENCES portal_users(id) ON DELETE SET NULL,
  number int NOT NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'question' CHECK (category IN ('question', 'support', 'billing', 'change_request')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  resolved_at timestamptz(3),
  UNIQUE (tenant_id, number)
);
CREATE INDEX portal_requests_status_idx ON portal_requests (tenant_id, status, updated_at DESC);
CREATE INDEX portal_requests_company_idx ON portal_requests (tenant_id, company_id);

-- One conversation per customer organisation (request_id NULL) and one per request.
CREATE TABLE portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id uuid REFERENCES portal_requests(id) ON DELETE CASCADE,
  author_portal_user_id uuid REFERENCES portal_users(id) ON DELETE SET NULL,
  author_user_id uuid,
  body text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (NOT (author_portal_user_id IS NOT NULL AND author_user_id IS NOT NULL))
);
CREATE INDEX portal_messages_thread_idx ON portal_messages (tenant_id, company_id, request_id, created_at);

CREATE TABLE portal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  content_type text NOT NULL,
  size_bytes int NOT NULL,
  data bytea NOT NULL,
  sha256 text NOT NULL,
  uploaded_by_user_id uuid,
  uploaded_by_portal_user_id uuid REFERENCES portal_users(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX portal_documents_company_idx ON portal_documents (tenant_id, company_id, created_at DESC);

-- What changed for a customer: shown as the portal's update feed.
CREATE TABLE portal_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX portal_updates_company_idx ON portal_updates (tenant_id, company_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_users', 'portal_sessions', 'portal_requests', 'portal_messages', 'portal_documents', 'portal_updates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $$;

-- Staff choose which tasks the customer sees as milestones.
ALTER TABLE tasks ADD COLUMN portal_visible boolean NOT NULL DEFAULT false;
-- A proposal approved or declined in the portal records who decided and why.
ALTER TABLE quotes ADD COLUMN decided_by_portal_user_id uuid REFERENCES portal_users(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN decision_note text;
