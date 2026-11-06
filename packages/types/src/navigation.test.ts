import { describe, expect, it } from 'vitest';
import { appPathSchema, MAX_RECENT, navKindForPath, pushRecent, updateNavigationSchema } from './navigation';

describe('navigation', () => {
  it('accepts only SampForce paths', () => {
    for (const ok of ['/app', '/app/leads', '/app/deals/0b6c1f8e-3c55-4c3e-9a7e-1d2f3a4b5c6d', '/app/reports?tab=flow']) {
      expect(appPathSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['https://evil.test', '//evil.test', '/app//evil.test', 'javascript:alert(1)', '/login', '/app/../login', '/app\\x', '/apps']) {
      expect(appPathSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('works out what a path points at', () => {
    expect(navKindForPath('/app')).toBe('module');
    expect(navKindForPath('/app/leads')).toBe('module');
    expect(navKindForPath('/app/leads/0b6c1f8e-3c55-4c3e-9a7e-1d2f3a4b5c6d')).toBe('lead');
    expect(navKindForPath('/app/deals/0b6c1f8e-3c55-4c3e-9a7e-1d2f3a4b5c6d')).toBe('deal');
    expect(navKindForPath('/app/settings/appearance')).toBe('page');
  });

  it('keeps recent visits unique, newest first and capped', () => {
    let list: ReturnType<typeof pushRecent> = [];
    for (let i = 0; i < 20; i++) list = pushRecent(list, { href: `/app/p${i % 17}`, label: `P${i}`, kind: 'page' }, new Date(2026, 0, 1, 0, i));
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.href).toBe('/app/p2');
    expect(new Set(list.map((r) => r.href)).size).toBe(MAX_RECENT);
  });

  it('rejects empty and unknown updates', () => {
    expect(updateNavigationSchema.safeParse({}).success).toBe(false);
    expect(updateNavigationSchema.safeParse({ recent: [] }).success).toBe(false);
    expect(updateNavigationSchema.safeParse({ moduleOrder: ['leads', 'DROP TABLE'] }).success).toBe(false);
  });
});
