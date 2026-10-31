-- Enhancement Phase 2: email automation on Automation Studio.
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
ALTER TABLE tasks ADD COLUMN priority "TaskPriority" NOT NULL DEFAULT 'NORMAL';

-- leads.engagement_score already exists (reports use it); contacts get the same column.
ALTER TABLE leads ADD COLUMN email_status text;
ALTER TABLE contacts ADD COLUMN email_status text, ADD COLUMN engagement_score integer;
ALTER TABLE leads ADD CONSTRAINT leads_email_status_check CHECK (email_status IS NULL OR email_status IN ('valid', 'risky', 'catch_all', 'invalid', 'unknown', 'bounced', 'needs_verification'));
ALTER TABLE contacts ADD CONSTRAINT contacts_email_status_check CHECK (email_status IS NULL OR email_status IN ('valid', 'risky', 'catch_all', 'invalid', 'unknown', 'bounced', 'needs_verification'));
ALTER TABLE leads ADD CONSTRAINT leads_engagement_score_check CHECK (engagement_score IS NULL OR engagement_score BETWEEN 0 AND 100);
ALTER TABLE contacts ADD CONSTRAINT contacts_engagement_score_check CHECK (engagement_score IS NULL OR engagement_score BETWEEN 0 AND 100);

-- Events that happened before a workflow was switched on never start it, even if relayed later.
ALTER TABLE workflows ADD COLUMN activated_at timestamptz(3);
UPDATE workflows SET activated_at = updated_at WHERE status = 'ACTIVE';
