import { z } from 'zod';
import type { NotificationRow } from './automation';
import { NOTIFICATION_CATEGORIES, type NotificationCategoryKey } from './crm-admin';

/*
 * Notification Center (ADR 0075): one store of notifications for every workspace level, reached three ways (the
 * bell, the home dashboard and the section the notification comes from), delivered live, with an optional chime.
 */

/**
 * The sections a notification can come from. `href` is the section's page; a notification belongs to the section
 * whose page its link opens, or, without a link, the first section whose `types` match (exact, or a prefix ending
 * in "."). A notification in no section still shows in the bell and on the home dashboard.
 */
export const NOTIFICATION_SECTIONS = [
  { key: 'leads', label: 'Inbound contacts', href: '/app/leads', types: ['lead.', 'lead_transfer.'] },
  { key: 'companies', label: 'Companies', href: '/app/companies', types: ['company.', 'client_concern.', 'customer.'] },
  { key: 'contacts', label: 'Contacts', href: '/app/contacts', types: ['contact.'] },
  { key: 'prospects', label: 'Prospect lists', href: '/app/prospects', types: ['prospect_list.'] },
  { key: 'deals', label: 'Deals', href: '/app/deals', types: ['deal.'] },
  { key: 'tasks', label: 'Tasks', href: '/app/tasks', types: ['task.', 'manager.'] },
  { key: 'follow-ups', label: 'Follow-ups', href: '/app/follow-ups', types: ['followup.'] },
  { key: 'approvals', label: 'Approvals', href: '/app/approvals', types: ['approval.'] },
  { key: 'quotes', label: 'Quotes', href: '/app/quotes', types: ['quote.'] },
  { key: 'rfqs', label: 'RFQs', href: '/app/rfqs', types: ['rfq.', 'sampbidx.'] },
  { key: 'contracts', label: 'Contracts', href: '/app/contracts', types: ['contract.'] },
  { key: 'portal', label: 'Client portal', href: '/app/portal', types: ['portal.'] },
  { key: 'communication', label: 'Inbox and messages', href: '/app/communication', types: ['inbox.', 'sms.', 'whatsapp.'] },
  { key: 'sequences', label: 'Sequences', href: '/app/sequences', types: ['sequence.', 'email.'] },
  { key: 'website-enquiries', label: 'Website enquiries', href: '/app/website-enquiries', types: ['website_enquiry.'] },
  { key: 'targets', label: 'Targets', href: '/app/targets', types: ['target.'] },
  { key: 'gamification', label: 'Competitions', href: '/app/gamification', types: ['gamification.'] },
  { key: 'announcements', label: 'Announcements', href: '/app/announcements', types: ['announcement.'] },
  { key: 'automation', label: 'Automation', href: '/app/automation', types: ['workflow.', 'webhook.'] },
  { key: 'integrations', label: 'Integrations', href: '/app/integrations', types: ['integration.'] },
  { key: 'meetings', label: 'Meetings', href: '/app/meetings', types: ['meeting.'] },
  { key: 'activities', label: 'Activities', href: '/app/activities', types: ['activity.'] },
  { key: 'customer-success', label: 'Customer success', href: '/app/customer-success', types: [] },
  { key: 'help', label: 'Help and support', href: '/app/help', types: ['support.', 'escalation.'] },
  { key: 'billing', label: 'Billing', href: '/app/billing', types: ['billing.'] },
] as const;
export type NotificationSectionKey = (typeof NOTIFICATION_SECTIONS)[number]['key'];
export const NOTIFICATION_SECTION_KEYS = NOTIFICATION_SECTIONS.map((s) => s.key) as [NotificationSectionKey, ...NotificationSectionKey[]];

const SECTION_BY_KEY = new Map<string, (typeof NOTIFICATION_SECTIONS)[number]>(NOTIFICATION_SECTIONS.map((s) => [s.key, s]));

export function notificationSection(key: string | null | undefined) {
  return key ? (SECTION_BY_KEY.get(key) ?? null) : null;
}

/** The section of an app path (`/app/leads/123?tab=x` is Leads), or null. */
export function sectionOfPath(path: string | null | undefined): NotificationSectionKey | null {
  if (!path) return null;
  const m = /^\/app\/([a-z-]+)/.exec(path.split(/[?#]/)[0] ?? '');
  return m && SECTION_BY_KEY.has(m[1]!) ? (m[1] as NotificationSectionKey) : null;
}

/** Where a notification comes from: the section its link opens, else the section its type belongs to. */
export function notificationSectionOf(type: string, link?: string | null): NotificationSectionKey | null {
  const byLink = sectionOfPath(link);
  if (byLink) return byLink;
  for (const s of NOTIFICATION_SECTIONS) {
    if ((s.types as readonly string[]).some((t) => (t.endsWith('.') ? type.startsWith(t) : type === t))) return s.key;
  }
  return null;
}

/** How a notification looks: urgent and action-required ones stand out, and play the brighter chime. */
export type NotificationTone = 'action' | 'important' | 'normal';
export function notificationTone(n: Pick<NotificationRow, 'priority' | 'actionRequired'>): NotificationTone {
  if (n.actionRequired) return 'action';
  if (n.priority === 'HIGH' || n.priority === 'URGENT') return 'important';
  return 'normal';
}

/** A notification as the Notification Center shows it: the stored row plus where it comes from. */
export interface CenterNotification extends NotificationRow {
  section: NotificationSectionKey | null;
}

export interface NotificationSummary {
  unread: number;
  /** Unread notifications that ask the person to do something. */
  actionRequired: number;
  /** Unread High or Urgent notifications. */
  important: number;
  /** Unread notifications per section (sections with none are left out). */
  bySection: Partial<Record<NotificationSectionKey, number>>;
  /** When the newest notification arrived, or null; the live connection waits for anything newer. */
  latestAt: string | null;
}

export interface NotificationPage {
  items: CenterNotification[];
  unread: number;
  /** Pass as `before` for the next page; null at the end. */
  next: string | null;
}

export const NOTIFICATION_FILTERS = ['all', 'unread', 'action'] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const notificationPageQuerySchema = z.object({
  filter: z.enum(NOTIFICATION_FILTERS).default('all'),
  /** Kept for the earlier `?unread=true` callers (the phone app). */
  unread: z.enum(['true', 'false']).optional(),
  section: z.enum(NOTIFICATION_SECTION_KEYS).optional(),
  /** Only notifications whose link opens this exact page (a record's own notifications). */
  link: z.string().max(500).startsWith('/app/').optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type NotificationPageQuery = z.infer<typeof notificationPageQuerySchema>;

export const notificationReadSchema = z.union([
  z.object({ ids: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(100)]) }).strict(),
  z.object({ section: z.enum(NOTIFICATION_SECTION_KEYS) }).strict(),
]);
export type NotificationReadInput = z.infer<typeof notificationReadSchema>;

export const notificationWaitQuerySchema = z.object({
  /** The `latestAt` the caller already has; the call returns as soon as something newer exists. */
  after: z.string().datetime().optional(),
  /** Seconds to wait at most (the browser uses 25, under common proxy time-outs). */
  wait: z.coerce.number().int().min(0).max(30).default(25),
});

// ───────────── Personal preferences ─────────────

/** Categories a person can mute the chime for: the workspace categories, plus everything else. */
export const SOUND_CATEGORY_KEYS = [...NOTIFICATION_CATEGORIES.map((c) => c.key), 'other'] as unknown as [NotificationCategoryKey | 'other', ...(NotificationCategoryKey | 'other')[]];
export type SoundCategoryKey = NotificationCategoryKey | 'other';

export const notificationPreferencesSchema = z
  .object({
    /** Play the chime when a notification arrives. */
    sound: z.boolean(),
    /** 0 to 100; the chime is quiet at the default 40. */
    volume: z.number().int().min(0).max(100),
    /** Categories that arrive silently. */
    mutedSound: z.array(z.enum(SOUND_CATEGORY_KEYS)).max(SOUND_CATEGORY_KEYS.length),
    /** Show the browser's or phone's own notification while SampForce is in the background. */
    desktop: z.boolean(),
  })
  .strict();
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { sound: true, volume: 40, mutedSound: [], desktop: false };

/** Whether a notification of this type plays the chime for someone with these preferences. */
export function notificationChimes(prefs: NotificationPreferences, type: string, categoryOf: (type: string) => NotificationCategoryKey | null): boolean {
  if (!prefs.sound || prefs.volume === 0) return false;
  return !prefs.mutedSound.includes(categoryOf(type) ?? 'other');
}
