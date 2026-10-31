-- Whether password sign-in is refused for this workspace (owners excepted). Kept on the tenant row so
-- the sign-in flow and workspace switcher can read it without the tenant context sso_connections needs.
ALTER TABLE "tenants" ADD COLUMN "sso_enforced" BOOLEAN NOT NULL DEFAULT false;
