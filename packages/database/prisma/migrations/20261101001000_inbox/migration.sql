-- Enhancement Phase 2d (feature 8): the inbox groups stored email into conversations that can be assigned,
-- categorised, linked to a deal and discussed in internal notes. Mailbox syncs are logged.

CREATE TABLE email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  -- The provider's thread id, or "msg:<email id>" when the provider gave none.
  thread_key text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WAITING', 'CLOSED')),
  category text CHECK (category IS NULL OR category IN ('sales', 'support', 'billing', 'partnership', 'other')),
  assigned_to_id uuid,
  contact_id uuid,
  lead_id uuid,
  deal_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  message_count int NOT NULL DEFAULT 0,
  last_message_at timestamptz(3) NOT NULL,
  last_direction text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT email_threads_connection_id_thread_key_key UNIQUE (connection_id, thread_key)
);
CREATE INDEX email_threads_tenant_id_last_message_at_idx ON email_threads (tenant_id, last_message_at DESC);
CREATE INDEX email_threads_tenant_id_assigned_to_id_idx ON email_threads (tenant_id, assigned_to_id);
CREATE INDEX email_threads_tenant_id_deal_id_idx ON email_threads (tenant_id, deal_id);
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_threads USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE email_messages ADD COLUMN conversation_id uuid REFERENCES email_threads(id) ON DELETE SET NULL;
CREATE INDEX email_messages_conversation_id_sent_at_idx ON email_messages (conversation_id, sent_at);

-- Every stored message joins its conversation, whichever path stored it (sync, send, sequence).
-- A new inbound message reopens the conversation; a reply sent from an open one marks it as waiting.
CREATE FUNCTION email_messages_join_thread() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t_id uuid;
BEGIN
  -- A duplicate that ON CONFLICT DO NOTHING will skip must not count twice.
  IF EXISTS (SELECT 1 FROM email_messages WHERE connection_id = NEW.connection_id AND provider_message_id = NEW.provider_message_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO email_threads AS t (tenant_id, connection_id, thread_key, subject, contact_id, lead_id, message_count, last_message_at, last_direction, status)
  VALUES (NEW.tenant_id, NEW.connection_id, COALESCE(NEW.thread_id, 'msg:' || NEW.id::text), left(NEW.subject, 500), NEW.contact_id, NEW.lead_id, 1, NEW.sent_at, NEW.direction::text,
          CASE WHEN NEW.direction::text = 'INBOUND' THEN 'OPEN' ELSE 'WAITING' END)
  ON CONFLICT (connection_id, thread_key) DO UPDATE SET
    message_count = t.message_count + 1,
    contact_id = COALESCE(t.contact_id, EXCLUDED.contact_id),
    lead_id = COALESCE(t.lead_id, EXCLUDED.lead_id),
    last_direction = CASE WHEN EXCLUDED.last_message_at >= t.last_message_at THEN EXCLUDED.last_direction ELSE t.last_direction END,
    last_message_at = GREATEST(t.last_message_at, EXCLUDED.last_message_at),
    status = CASE
      WHEN EXCLUDED.last_direction = 'INBOUND' AND EXCLUDED.last_message_at >= t.last_message_at THEN 'OPEN'
      WHEN EXCLUDED.last_direction = 'OUTBOUND' AND t.status = 'OPEN' AND EXCLUDED.last_message_at >= t.last_message_at THEN 'WAITING'
      ELSE t.status END,
    updated_at = now()
  RETURNING id INTO t_id;
  NEW.conversation_id := t_id;
  RETURN NEW;
END $$;
CREATE TRIGGER email_messages_join_thread BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION email_messages_join_thread();

-- Existing mail: one conversation per provider thread, in date order.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, tenant_id, connection_id, thread_id, subject, contact_id, lead_id, sent_at, direction FROM email_messages ORDER BY sent_at LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id::text, true);
    INSERT INTO email_threads AS t (tenant_id, connection_id, thread_key, subject, contact_id, lead_id, message_count, last_message_at, last_direction, status)
    VALUES (r.tenant_id, r.connection_id, COALESCE(r.thread_id, 'msg:' || r.id::text), left(r.subject, 500), r.contact_id, r.lead_id, 1, r.sent_at, r.direction::text,
            CASE WHEN r.direction::text = 'INBOUND' THEN 'OPEN' ELSE 'WAITING' END)
    ON CONFLICT (connection_id, thread_key) DO UPDATE SET
      message_count = t.message_count + 1,
      contact_id = COALESCE(t.contact_id, EXCLUDED.contact_id),
      lead_id = COALESCE(t.lead_id, EXCLUDED.lead_id),
      last_message_at = EXCLUDED.last_message_at,
      last_direction = EXCLUDED.last_direction,
      status = EXCLUDED.status;
    UPDATE email_messages SET conversation_id = (SELECT id FROM email_threads WHERE connection_id = r.connection_id AND thread_key = COALESCE(r.thread_id, 'msg:' || r.id::text)) WHERE id = r.id;
  END LOOP;
END $$;

CREATE TABLE email_thread_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  author_id uuid,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX email_thread_notes_thread_id_created_at_idx ON email_thread_notes (thread_id, created_at);
ALTER TABLE email_thread_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_thread_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_thread_notes USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

CREATE TABLE integration_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  ok boolean NOT NULL,
  emails int NOT NULL DEFAULT 0,
  meetings int NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz(3) NOT NULL,
  finished_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX integration_sync_logs_connection_id_started_at_idx ON integration_sync_logs (connection_id, started_at DESC);
CREATE INDEX integration_sync_logs_tenant_id_idx ON integration_sync_logs (tenant_id);
ALTER TABLE integration_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_sync_logs USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
