-- Enhancement Phase 2d: proposals on top of quotes (feature 9).
ALTER TABLE "quotes"
  ADD COLUMN "sections" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "share_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "first_viewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_viewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sections_array_check" CHECK (jsonb_typeof("sections") = 'array');

ALTER TABLE "commercial_settings"
  ADD COLUMN "proposal_header" TEXT,
  ADD COLUMN "proposal_footer" TEXT,
  ADD COLUMN "logo_data_url" TEXT;
ALTER TABLE "commercial_settings" ADD CONSTRAINT "commercial_settings_logo_check"
  CHECK ("logo_data_url" IS NULL OR (length("logo_data_url") <= 350000 AND "logo_data_url" ~ '^data:image/(png|jpeg);base64,'));
