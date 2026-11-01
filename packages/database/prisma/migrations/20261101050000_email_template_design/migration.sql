-- Designed emails (ADR 0050): an optional list of blocks on an email template.
ALTER TABLE "email_templates" ADD COLUMN "design" JSONB;
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_design_shape" CHECK ("design" IS NULL OR jsonb_typeof("design" -> 'blocks') = 'array');
