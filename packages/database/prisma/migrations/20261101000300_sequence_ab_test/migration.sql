-- A/B tests on sequence emails: which version each sent email used.
ALTER TABLE "sequence_messages" ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'A';
ALTER TABLE "sequence_messages" ADD CONSTRAINT "sequence_messages_variant_check" CHECK ("variant" IN ('A', 'B'));
