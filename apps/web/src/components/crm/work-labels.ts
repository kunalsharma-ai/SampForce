import type { FollowUpBucket, FollowUpDue, FollowUpType, InteractionKind, RfqService, RfqServiceCategory, RfqStatus } from '@dealflow/types';
import type { MessageKey } from '@/lib/i18n';

/** Labels for interaction kinds, follow-up types and states, and RFQ statuses (ADR 0060, Phase 3). */

export const INTERACTION_LABEL = {
  EMAIL_SENT: 'Email sent',
  EMAIL_RECEIVED: 'Email received',
  CALL_OUTGOING: 'Outgoing call',
  CALL_INCOMING: 'Incoming call',
  MEETING: 'Meeting',
  LINKEDIN: 'LinkedIn message',
  WHATSAPP: 'WhatsApp message',
  RFQ_RECEIVED: 'RFQ received',
  RFQ_SUBMITTED: 'RFQ submitted',
  NEGOTIATION: 'Commercial negotiation',
  OTHER: 'Other interaction',
} as const satisfies Record<InteractionKind, MessageKey>;

export const FOLLOW_UP_TYPE_LABEL = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  LINKEDIN: 'LinkedIn',
  WHATSAPP: 'WhatsApp',
  RFQ: 'RFQ',
  VISIT: 'Visit',
  OTHER: 'Other',
} as const satisfies Record<FollowUpType, MessageKey>;

export const BUCKET_LABEL = {
  today: "Today's follow-ups",
  upcoming: 'Upcoming follow-ups',
  overdue: 'Overdue follow-ups',
  completed: 'Completed follow-ups',
  rescheduled: 'Rescheduled follow-ups',
  cancelled: 'Cancelled follow-ups',
} as const satisfies Record<FollowUpBucket, MessageKey>;

export const DUE_LABEL = {
  OVERDUE: 'Overdue',
  TODAY: 'Due today',
  TOMORROW: 'Due tomorrow',
  UPCOMING: 'Upcoming',
  NO_DATE: 'No date',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const satisfies Record<FollowUpDue, MessageKey>;

export const DUE_TONE: Record<FollowUpDue, 'critical' | 'warning' | 'primary' | 'neutral' | 'success'> = {
  OVERDUE: 'critical',
  TODAY: 'warning',
  TOMORROW: 'primary',
  UPCOMING: 'neutral',
  NO_DATE: 'neutral',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const PRIORITY_LABEL = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High' } as const satisfies Record<'LOW' | 'NORMAL' | 'HIGH', MessageKey>;

export const RFQ_STATUS_LABEL = {
  RECEIVED: 'Received',
  UNDER_EVALUATION: 'Under evaluation',
  PRICING: 'Pricing in progress',
  QUOTATION_SUBMITTED: 'Quotation submitted',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
} as const satisfies Record<RfqStatus, MessageKey>;

export const RFQ_STATUS_TONE: Record<RfqStatus, 'primary' | 'accent' | 'warning' | 'success' | 'critical' | 'neutral'> = {
  RECEIVED: 'primary',
  UNDER_EVALUATION: 'accent',
  PRICING: 'accent',
  QUOTATION_SUBMITTED: 'warning',
  NEGOTIATION: 'warning',
  WON: 'success',
  LOST: 'critical',
  CANCELLED: 'neutral',
  ON_HOLD: 'neutral',
};

/** A follow-up category or RFQ status as the workspace configured it (ADR 0062): its label and colour, or the built-in label. */
export function optionLabel(row: { label: string } | null | undefined, value: string, builtIn: Record<string, MessageKey>, t: { maybe: (s: string) => string; (k: MessageKey): string }): string {
  if (row) return t.maybe(row.label);
  return value in builtIn ? t(builtIn[value]!) : value;
}

export const RFQ_SERVICE_CATEGORY_LABEL = { QUANTITATIVE: 'Quantitative', QUALITATIVE: 'Qualitative' } as const satisfies Record<RfqServiceCategory, MessageKey>;

/** Research services: the industry abbreviations stay as they are in every language. */
export function rfqServiceLabel(s: RfqService | string, t: (k: MessageKey) => string): string {
  if (s === 'ONLINE_COMMUNITY') return t('Online community');
  if (s === 'OTHER') return t('Other');
  return s === 'F2F' ? 'F2F' : s;
}
