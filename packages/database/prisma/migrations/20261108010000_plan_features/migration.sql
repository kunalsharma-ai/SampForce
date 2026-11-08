-- Plan features (ADR 0057). Each plan lists the features it includes in plans.entitlements.features; operators edit
-- the list in the console. The apiAccess and customRoles flags become the api_access and custom_roles features.
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["email_sync","ai_assistant","automation","reports","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'free';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["quotes","email_sync","email_templates","sequences","browser_extension","marketing","campaigns","ai_assistant","automation","reports","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'launch';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["territories","quotes","proposals","contracts","email_sync","team_inbox","email_templates","sequences","email_finder","prospect_lists","browser_extension","marketing","campaigns","meeting_intelligence","ai_assistant","automation","sales_intelligence","forecasting","reports","gamification","slack","teams","zoom","api_access","webhooks","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'growth';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["territories","quotes","proposals","contracts","email_sync","team_inbox","email_templates","sequences","email_finder","prospect_lists","browser_extension","marketing","campaigns","website_visitors","meeting_intelligence","voice_notes","ai_assistant","automation","sales_intelligence","forecasting","revenue_intelligence","reports","gamification","client_portal","customer_success","slack","teams","zoom","docusign","card_payments","whatsapp","sms","api_access","webhooks","custom_roles","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'professional';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["territories","quotes","proposals","contracts","email_sync","team_inbox","email_templates","sequences","email_finder","prospect_lists","browser_extension","marketing","campaigns","website_visitors","meeting_intelligence","voice_notes","ai_assistant","automation","sales_intelligence","forecasting","revenue_intelligence","reports","gamification","client_portal","customer_success","slack","teams","zoom","docusign","card_payments","whatsapp","sms","api_access","webhooks","custom_roles","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'business';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["territories","quotes","proposals","contracts","email_sync","team_inbox","email_templates","sequences","email_finder","prospect_lists","browser_extension","marketing","campaigns","website_visitors","meeting_intelligence","voice_notes","ai_assistant","automation","sales_intelligence","forecasting","revenue_intelligence","reports","gamification","client_portal","customer_success","slack","teams","zoom","docusign","card_payments","whatsapp","sms","api_access","webhooks","custom_roles","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'enterprise';
UPDATE plans SET entitlements = (entitlements - 'apiAccess' - 'customRoles') || jsonb_build_object('features', '["territories","quotes","proposals","contracts","email_sync","team_inbox","email_templates","sequences","email_finder","prospect_lists","browser_extension","marketing","campaigns","website_visitors","meeting_intelligence","voice_notes","ai_assistant","automation","sales_intelligence","forecasting","revenue_intelligence","reports","gamification","client_portal","customer_success","slack","teams","zoom","docusign","card_payments","whatsapp","sms","api_access","webhooks","custom_roles","sso_scim"]'::jsonb), updated_at = now() WHERE code = 'enterprise_plus';

-- Features a platform operator granted or withheld for one workspace, whatever its plan includes.
CREATE TABLE "tenant_feature_overrides" (
    "tenant_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_feature_overrides_pkey" PRIMARY KEY ("tenant_id","feature"),
    CONSTRAINT "tenant_feature_overrides_feature_shape" CHECK ("feature" ~ '^[a-z][a-z_]{1,39}$')
);

ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: a workspace reads only its own overrides; the operator console lists them across workspaces.
ALTER TABLE tenant_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_feature_overrides USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY operator_scan ON tenant_feature_overrides FOR SELECT USING (app_operator_scan());
