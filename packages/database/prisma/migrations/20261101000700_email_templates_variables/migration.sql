-- Enhancement Phase 2b: template categories and campaigns, and workspace email variables.
ALTER TABLE email_templates ADD COLUMN category text, ADD COLUMN campaign_id uuid;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_category_check CHECK (category IS NULL OR length(category) BETWEEN 1 AND 40);
ALTER TABLE email_templates ADD CONSTRAINT email_templates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX email_templates_tenant_id_category_idx ON email_templates (tenant_id, category);

CREATE TABLE email_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  value text NOT NULL DEFAULT '' CHECK (length(value) <= 2000),
  updated_by_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT email_variables_tenant_id_key_key UNIQUE (tenant_id, key)
);
ALTER TABLE email_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_variables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_variables USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
