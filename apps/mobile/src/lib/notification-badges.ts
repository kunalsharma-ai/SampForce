import type { NotificationSummary } from '@dealflow/types';

/* Plain helpers for the phone's Notification Center (ADR 0075, part 4), kept apart so they are unit-tested. */

export const SUMMARY_EVERY_MS = 20_000;

/** The tab (Mobile Configuration module) whose badge counts a notification section. */
export const MODULE_SECTION: Partial<Record<string, keyof NotificationSummary['bySection']>> = {
  companies: 'companies',
  contacts: 'contacts',
  follow_ups: 'follow-ups',
  tasks: 'tasks',
  deals: 'deals',
  targets: 'targets',
};

/** The badge a tab shows: its section's unread count, the total on Notifications, nothing when zero. */
export function badgeFor(module: string, summary: NotificationSummary | null): number | undefined {
  if (!summary) return undefined;
  const n = module === 'notifications' ? summary.unread : (MODULE_SECTION[module] ? (summary.bySection[MODULE_SECTION[module]!] ?? 0) : 0);
  return n > 0 ? n : undefined;
}

/** "99+" past 99, so a badge stays round. */
export function badgeText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** Whether a new summary means something arrived since the last one (not on the first look). */
export function arrived(before: NotificationSummary | null, after: NotificationSummary): boolean {
  if (!before || !after.latestAt) return false;
  if (before.latestAt && after.latestAt <= before.latestAt) return false;
  return after.unread > before.unread;
}

/** Where a section's notifications live on the web, so a record opened on the phone reads the same rows. */
const SECTION_HREF: Record<string, string> = { companies: '/app/companies', contacts: '/app/contacts', 'follow-ups': '/app/follow-ups', tasks: '/app/tasks', deals: '/app/deals', targets: '/app/targets' };

/**
 * What opening a screen reads (ADR 0075): a module's list reads its whole section; one record reads the notifications
 * about that record; anything else (a form, Notifications itself, Profile) reads nothing.
 */
export function readTargetFor(pathname: string): { section: string } | { link: string } | null {
  const [module, id, extra] = pathname.split(/[?#]/)[0]!.split('/').filter(Boolean);
  const section = module ? MODULE_SECTION[module] : undefined;
  if (!section) return null;
  if (!id) return { section };
  if (extra || id === 'form' || id === 'new') return null;
  return { link: `${SECTION_HREF[section]}/${id}` };
}
