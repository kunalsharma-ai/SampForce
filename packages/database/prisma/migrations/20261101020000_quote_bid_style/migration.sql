-- Bid template look on quotes (design spec Part 6: Quick Bid Studio).
ALTER TABLE "quotes" ADD COLUMN "template_key" TEXT;
ALTER TABLE "quotes" ADD COLUMN "accent_color" TEXT;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accent_color_check" CHECK ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-fA-F]{6}$');
