-- Enhancement feature 10: forecast planning. Managers set how probabilities and categories are worked out.
CREATE TABLE forecast_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'stage' CHECK (method IN ('stage', 'history')),
  commit_threshold int NOT NULL DEFAULT 70 CHECK (commit_threshold BETWEEN 1 AND 100),
  best_case_threshold int NOT NULL DEFAULT 30 CHECK (best_case_threshold BETWEEN 0 AND 99),
  history_months int NOT NULL DEFAULT 12 CHECK (history_months BETWEEN 3 AND 36),
  min_sample int NOT NULL DEFAULT 10 CHECK (min_sample BETWEEN 3 AND 200),
  updated_by_id uuid,
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (best_case_threshold < commit_threshold)
);
ALTER TABLE forecast_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON forecast_settings USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- The category thresholds a snapshot used, so it recomputes to the same totals. NULL = the original 70/30.
ALTER TABLE forecast_snapshots ADD COLUMN assumptions jsonb;
-- Month, quarter and year snapshots can start on the same day; lookups now match the end too.
CREATE INDEX forecast_snapshots_period_idx ON forecast_snapshots (tenant_id, period_start, period_end);
