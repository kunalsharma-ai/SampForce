-- Enhancement Phase 2c: the Email Assistant's latest reading of a received email.
ALTER TABLE "email_messages"
  ADD COLUMN "ai_intent" TEXT,
  ADD COLUMN "ai_analysed_at" TIMESTAMPTZ(3);
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_ai_intent_check"
  CHECK ("ai_intent" IS NULL OR "ai_intent" IN ('interested', 'meeting_request', 'question', 'objection', 'not_now', 'not_interested', 'unsubscribe', 'referral', 'out_of_office', 'other'));
