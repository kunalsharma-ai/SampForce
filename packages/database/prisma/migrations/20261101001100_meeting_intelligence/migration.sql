-- Enhancement Phase 2d (feature 7): meeting intelligence. A meeting record holds a transcript (pasted, or from a
-- recording transcribed by Deepgram; the audio itself is never stored), the AI's structured reading of it, the
-- person's reviewed edits, and the tasks and record note created from it.

ALTER TABLE meetings ADD COLUMN join_url text;

CREATE TABLE meeting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  occurred_at timestamptz(3) NOT NULL,
  contact_id uuid,
  lead_id uuid,
  deal_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'notes' CHECK (source IN ('notes', 'transcript', 'recording')),
  transcript text CHECK (transcript IS NULL OR length(transcript) <= 200000),
  -- [{ speaker, start, end, text }] when the transcription service told speakers apart.
  segments jsonb CHECK (segments IS NULL OR jsonb_typeof(segments) = 'array'),
  transcription_status text NOT NULL DEFAULT 'none' CHECK (transcription_status IN ('none', 'processing', 'done', 'failed')),
  transcription_provider text,
  transcription_error text,
  recording_consent_by_id uuid,
  recording_consent_at timestamptz(3),
  analysis jsonb CHECK (analysis IS NULL OR jsonb_typeof(analysis) = 'object'),
  ai_run_id uuid,
  analysed_at timestamptz(3),
  reviewed_by_id uuid,
  reviewed_at timestamptz(3),
  activity_id uuid,
  task_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX meeting_records_tenant_id_occurred_at_idx ON meeting_records (tenant_id, occurred_at DESC);
CREATE INDEX meeting_records_tenant_id_deal_id_idx ON meeting_records (tenant_id, deal_id);
CREATE INDEX meeting_records_tenant_id_contact_id_idx ON meeting_records (tenant_id, contact_id);
CREATE UNIQUE INDEX meeting_records_meeting_id_key ON meeting_records (meeting_id) WHERE meeting_id IS NOT NULL;
ALTER TABLE meeting_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_records USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
