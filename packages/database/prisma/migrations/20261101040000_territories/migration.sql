-- Sales territories (design spec Part 5, territory view): named sets of countries with an optional manager. A deal
-- belongs to the territory holding its company's country; a country is in at most one territory per workspace.

-- CreateTable
CREATE TABLE "territories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "manager_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_countries" (
    "tenant_id" UUID NOT NULL,
    "territory_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,

    CONSTRAINT "territory_countries_pkey" PRIMARY KEY ("territory_id","country")
);

-- CreateIndex
CREATE UNIQUE INDEX "territories_tenant_id_name_key" ON "territories"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "territory_countries_tenant_id_country_key" ON "territory_countries"("tenant_id", "country");

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_countries" ADD CONSTRAINT "territory_countries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_countries" ADD CONSTRAINT "territory_countries_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Names are unique regardless of case, so "DACH" and "dach" cannot both exist.
CREATE UNIQUE INDEX territories_tenant_id_lower_name_key ON territories (tenant_id, lower(name));

ALTER TABLE territory_countries ADD CONSTRAINT territory_countries_country_check CHECK (country ~ '^[A-Z]{2}$');

-- Row-level security: tenant isolation, like every workspace table.
ALTER TABLE territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE territories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON territories USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE territory_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_countries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON territory_countries USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
