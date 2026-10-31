-- Enhancement Phase 3 (feature 12): voice-to-CRM. A voice note is a dictation, typed or recorded. Recordings are
-- streamed to Deepgram and only the text is kept. The AI proposes CRM actions; nothing is created until the person
-- confirms, and what was created is recorded on the note.

CREATE TABLE voice_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  lead_id uuid,
  contact_id uuid,
  deal_id uuid,
  company_id uuid,
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'recording')),
  language text NOT NULL DEFAULT 'auto' CHECK (length(language) BETWEEN 2 AND 10),
  transcript text CHECK (transcript IS NULL OR length(transcript) <= 50000),
  detected_language text,
  duration_seconds numeric(10, 2),
  transcription_status text NOT NULL DEFAULT 'none' CHECK (transcription_status IN ('none', 'processing', 'done', 'failed')),
  transcription_provider text,
  transcription_error text,
  -- { summary, actions: [...], lastCallRequested, unsupported: [...] }
  interpretation jsonb CHECK (interpretation IS NULL OR jsonb_typeof(interpretation) = 'object'),
  ai_run_id uuid,
  interpreted_at timestamptz(3),
  applied_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(lead_id, contact_id, deal_id, company_id) <= 1)
);
CREATE INDEX voice_notes_user_idx ON voice_notes (tenant_id, user_id, created_at DESC);
CREATE INDEX voice_notes_record_idx ON voice_notes (tenant_id, lead_id, contact_id, deal_id, company_id);
ALTER TABLE voice_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON voice_notes USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
