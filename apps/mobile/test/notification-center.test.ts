import type { NotificationSummary } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { arrived, badgeFor, badgeText, readTargetFor } from '../src/lib/notification-badges';

const sum = (over: Partial<NotificationSummary>): NotificationSummary => ({ unread: 0, actionRequired: 0, important: 0, bySection: {}, latestAt: null, ...over });

describe('notification badges on the phone', () => {
  it('counts a tab’s own section, the total on Notifications, and nothing when zero', () => {
    const s = sum({ unread: 7, bySection: { tasks: 2, 'follow-ups': 3, deals: 0 } });
    expect(badgeFor('notifications', s)).toBe(7);
    expect(badgeFor('tasks', s)).toBe(2);
    expect(badgeFor('follow_ups', s)).toBe(3);
    expect(badgeFor('deals', s)).toBeUndefined();
    expect(badgeFor('chat', s)).toBeUndefined();
    expect(badgeFor('tasks', null)).toBeUndefined();
  });

  it('keeps a badge round past 99', () => {
    expect(badgeText(5)).toBe('5');
    expect(badgeText(140)).toBe('99+');
  });

  it('announces only something newer and unread, never on the first look', () => {
    const a = sum({ unread: 1, latestAt: '2026-11-23T10:00:00.000Z' });
    expect(arrived(null, a)).toBe(false);
    expect(arrived(a, sum({ unread: 2, latestAt: '2026-11-23T10:05:00.000Z' }))).toBe(true);
    // Read elsewhere: newer but fewer unread.
    expect(arrived(a, sum({ unread: 0, latestAt: '2026-11-23T10:05:00.000Z' }))).toBe(false);
    expect(arrived(a, sum({ unread: 3, latestAt: '2026-11-23T10:00:00.000Z' }))).toBe(false);
  });
});

describe('opening a screen reads its notifications', () => {
  it('reads a module’s whole section from its list, and one record’s from its page', () => {
    expect(readTargetFor('/tasks')).toEqual({ section: 'tasks' });
    expect(readTargetFor('/follow_ups')).toEqual({ section: 'follow-ups' });
    expect(readTargetFor('/companies/0b8f3c1e-1111-4222-8333-444455556666')).toEqual({ link: '/app/companies/0b8f3c1e-1111-4222-8333-444455556666' });
    expect(readTargetFor('/companies/form')).toBeNull();
    expect(readTargetFor('/notifications')).toBeNull();
    expect(readTargetFor('/profile')).toBeNull();
    expect(readTargetFor('/dashboard')).toBeNull();
  });
});
