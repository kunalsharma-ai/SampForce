-- Language and regional formats per person. Like user_preferences it carries no tenant_id and no row-level
-- security: it belongs to the person, and the API only ever reads and writes the caller's own row.

-- CreateTable
CREATE TABLE "user_regional_settings" (
    "user_id" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "format_locale" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_regional_settings_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_regional_settings_language_check" CHECK ("language" IN ('en', 'es', 'fr', 'de', 'ar')),
    CONSTRAINT "user_regional_settings_format_locale_check" CHECK ("format_locale" IS NULL OR char_length("format_locale") BETWEEN 2 AND 35)
);

-- AddForeignKey
ALTER TABLE "user_regional_settings" ADD CONSTRAINT "user_regional_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
