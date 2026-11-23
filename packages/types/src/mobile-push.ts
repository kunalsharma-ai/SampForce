import { z } from 'zod';
import type { MobileNotificationType } from './mobile-config';

/*
 * Push notifications on the phone and announcements (ADR 0072, M8).
 */

/** An Expo push token, as the phone gets it from Expo (`ExponentPushToken[…]`). */
export const mobilePushTokenSchema = z
  .object({
    token: z
      .string()
      .trim()
      .max(200)
      .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/, 'This is not a push token from the SampForce app.'),
  })
  .strict();

/**
 * Which phone notification type each web notification is sent as. A web notification with no entry stays on the web
 * (in the bell) and is not pushed to phones.
 */
export const MOBILE_PUSH_TYPE_OF: Readonly<Record<string, MobileNotificationType>> = {
  'task.assigned': 'task_assigned',
  'followup.assigned': 'task_assigned',
  'task.due_soon': 'task_due_soon',
  'task.overdue': 'task_overdue',
  'followup.reminder': 'follow_up_reminder',
  'followup.overdue': 'follow_up_reminder',
  'lead.assigned': 'lead_assigned',
  'company.assigned': 'lead_assigned',
  'target.set': 'target_update',
  'announcement.posted': 'announcement',
  'billing.trial_ended': 'account_status',
  'billing.subscription_ended': 'account_status',
  'billing.unpaid': 'account_status',
};

/**
 * Where a tap on a notification opens the app, from the web link it carries. Links to pages the app does not have
 * open the notifications screen (null).
 */
export function mobileRouteFor(link: string | null | undefined): string | null {
  if (!link) return null;
  let path: string;
  let query: URLSearchParams;
  try {
    const url = new URL(link, 'https://app.invalid');
    path = url.pathname;
    query = url.searchParams;
  } catch {
    return null;
  }
  const id = /^[0-9a-f-]{36}$/i;
  const m = /^\/app\/([a-z-]+)(?:\/([^/]+))?\/?$/.exec(path);
  if (!m) return null;
  const [, section, rest] = m;
  const one = (base: string) => (rest && id.test(rest) ? `${base}/${rest}` : base);
  switch (section) {
    case 'companies':
      return one('/companies');
    case 'contacts':
      return one('/contacts');
    case 'follow-ups':
      return '/follow_ups';
    case 'tasks':
      return query.get('task') && id.test(query.get('task')!) ? `/tasks/${query.get('task')}` : one('/tasks');
    case 'chat':
      return query.get('c') && id.test(query.get('c')!) ? `/chat/${query.get('c')}` : '/chat';
    case 'targets':
      return '/targets';
    case 'announcements':
      return '/notifications';
    default:
      return null;
  }
}

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(2, 'Give the announcement a title.').max(120),
    body: z.string().trim().min(1, 'Write the announcement.').max(2000),
  })
  .strict();
export type AnnouncementInput = z.input<typeof announcementInputSchema>;

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  /** Who posted it; null once they have left the organisation. */
  author: { id: string; name: string } | null;
  createdAt: string;
}

/** What the person allowed on this phone, as the server knows it. */
export interface MobilePushStatus {
  /** The organisation's configuration sends notifications to this person's level. */
  enabled: boolean;
  /** This phone has a push token on the server. */
  registered: boolean;
}
