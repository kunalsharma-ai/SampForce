import { Badge } from '@dealflow/ui';
import { EMAIL_STATUS_LABELS, type EmailStatus } from '@dealflow/types';

const TONE: Record<EmailStatus, 'success' | 'warning' | 'critical' | 'neutral'> = {
  valid: 'success',
  risky: 'warning',
  catch_all: 'warning',
  invalid: 'critical',
  unknown: 'neutral',
  bounced: 'critical',
  needs_verification: 'warning',
};

/** The last known state of an address. Bounced and flagged addresses should be checked before anyone writes again. */
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <Badge tone={TONE[status]}>{EMAIL_STATUS_LABELS[status]}</Badge>;
}
