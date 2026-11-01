-- Saved data table views per list, private or shared read-only with the workspace.

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_tenant_id_user_id_entity_name_key" ON "saved_views"("tenant_id", "user_id", "entity", "name");

-- CreateIndex
CREATE INDEX "saved_views_tenant_id_entity_idx" ON "saved_views"("tenant_id", "entity");

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE saved_views ADD CONSTRAINT saved_views_entity_check CHECK (entity IN ('leads', 'contacts', 'companies', 'deals'));

-- Row-level security: everyone in the workspace reads their own and shared views; only the creator writes.
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY saved_views_read ON saved_views FOR SELECT
  USING (tenant_id = app_current_tenant() AND (user_id = app_current_user() OR shared));
CREATE POLICY saved_views_insert ON saved_views FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
CREATE POLICY saved_views_update ON saved_views FOR UPDATE
  USING (tenant_id = app_current_tenant() AND user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
CREATE POLICY saved_views_delete ON saved_views FOR DELETE
  USING (tenant_id = app_current_tenant() AND user_id = app_current_user());
