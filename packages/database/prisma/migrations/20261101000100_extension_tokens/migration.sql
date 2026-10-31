-- Browser extension connections are sessions with their own bearer token (only its hash is stored).
-- They show in the person's signed-in devices and end with every other sign-out.
ALTER TABLE "sessions" ADD COLUMN "extension_token_hash" TEXT;
ALTER TABLE "sessions" ADD COLUMN "extension_name" TEXT;
ALTER TABLE "sessions" ADD COLUMN "last_used_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "sessions_extension_token_hash_key" ON "sessions"("extension_token_hash");
