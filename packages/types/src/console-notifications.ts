import { z } from 'zod';
import type { OperatorPermission } from './console-security';

/**
 * Console notifications (ADR 0074, C3b). The worker writes them from the platform's own records; each operator
 * receives only the types their role may act on, in the Console, by email, both or neither, as they choose.
 */
export const OPERATOR_NOTIFICATION_TYPES = [
  'client.created',
  'workspace.created',
  'subscription.expiring',
  'payment.failed',
  'payment.overdue',
  'ticket.new',
  'ticket.sla_breached',
  'provider.check_failed',
  'signin.unusual',
  'feature.changed',
] as const;
export type OperatorNotificationType = (typeof OPERATOR_NOTIFICATION_TYPES)[number];

export interface OperatorNotificationDef {
  type: OperatorNotificationType;
  label: string;
  description: string;
  /** Who receives it: operators whose role has this permission. */
  permission: OperatorPermission;
  /** Sent by email as well unless the operator turns it off. */
  emailByDefault: boolean;
  /** Plays the urgent chime when the operator has sounds on. */
  urgent: boolean;
}

export const OPERATOR_NOTIFICATION_DEFS: Record<OperatorNotificationType, OperatorNotificationDef> = {
  'client.created': { type: 'client.created', label: 'New client', description: 'A client signs up or is added in the Console.', permission: 'clients.view', emailByDefault: false, urgent: false },
  'workspace.created': { type: 'workspace.created', label: 'New workspace', description: 'A client adds a Manager or Executive Workspace.', permission: 'workspaces.view', emailByDefault: false, urgent: false },
  'subscription.expiring': { type: 'subscription.expiring', label: 'Subscription ending', description: 'A subscription that does not renew by itself ends in 14 days, and again at 3 days.', permission: 'subscriptions.manage', emailByDefault: true, urgent: false },
  'payment.failed': { type: 'payment.failed', label: 'Payment failed', description: 'A client’s payment fails and the subscription is past due.', permission: 'billing.view', emailByDefault: true, urgent: true },
  'payment.overdue': { type: 'payment.overdue', label: 'Invoice overdue', description: 'An invoice is still open 14 days after it was issued.', permission: 'billing.view', emailByDefault: true, urgent: false },
  'ticket.new': { type: 'ticket.new', label: 'New ticket', description: 'A ticket reaches SampForce support, sent directly or escalated.', permission: 'support.handle', emailByDefault: false, urgent: false },
  'ticket.sla_breached': { type: 'ticket.sla_breached', label: 'Ticket past its response time', description: 'A ticket has no answer after 24 hours, or 8 hours when it is high priority.', permission: 'support.handle', emailByDefault: true, urgent: true },
  'provider.check_failed': { type: 'provider.check_failed', label: 'Provider check failed', description: 'A connection test to a provider (email, payments, AI and others) fails.', permission: 'providers.manage', emailByDefault: true, urgent: true },
  'signin.unusual': { type: 'signin.unusual', label: 'Unusual sign-in', description: 'An operator signs in after several failures or from a new address.', permission: 'security.manage', emailByDefault: true, urgent: true },
  'feature.changed': { type: 'feature.changed', label: 'Features changed', description: 'An operator changes a plan’s features or a client’s feature overrides.', permission: 'features.manage', emailByDefault: false, urgent: false },
};

export interface OperatorNotificationRow {
  id: string;
  type: OperatorNotificationType;
  title: string;
  body: string | null;
  link: string | null;
  client: { id: string; name: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface OperatorNotificationPage {
  items: OperatorNotificationRow[];
  unread: number;
  /** Pass as `before` for the next page; null at the end. */
  next: string | null;
}

export const operatorNotificationQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type OperatorNotificationQuery = z.infer<typeof operatorNotificationQuerySchema>;

export interface OperatorNotificationPrefRow {
  type: OperatorNotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

export const operatorNotificationPrefsSchema = z
  .object({
    prefs: z
      .array(z.object({ type: z.enum(OPERATOR_NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() }).strict())
      .min(1)
      .max(OPERATOR_NOTIFICATION_TYPES.length),
  })
  .strict();
export type OperatorNotificationPrefsInput = z.infer<typeof operatorNotificationPrefsSchema>;
