-- Personal navigation per workspace: pinned pages and records, recent visits, sidebar order and hidden modules.

-- CreateTable
CREATE TABLE "workspace_navigation" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pinned" JSONB NOT NULL DEFAULT '[]',
    "recent" JSONB NOT NULL DEFAULT '[]',
    "module_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidden_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_navigation_pkey" PRIMARY KEY ("tenant_id","user_id")
);

-- AddForeignKey
ALTER TABLE "workspace_navigation" ADD CONSTRAINT "workspace_navigation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_navigation" ADD CONSTRAINT "workspace_navigation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: the current workspace and the current person only.
ALTER TABLE workspace_navigation ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_navigation FORCE ROW LEVEL SECURITY;
CREATE POLICY own_navigation ON workspace_navigation
  USING (tenant_id = app_current_tenant() AND user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
