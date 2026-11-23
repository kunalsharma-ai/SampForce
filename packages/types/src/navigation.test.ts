import { describe, expect, it } from 'vitest';
import { appPathSchema, navKindForPath, updateNavigationSchema } from './navigation';

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

  it('rejects empty and unknown updates', () => {
    expect(updateNavigationSchema.safeParse({}).success).toBe(false);
    // Recent pages are not kept, so a client cannot store them through the update either.
    expect(updateNavigationSchema.safeParse({ recent: [] }).success).toBe(false);
    expect(updateNavigationSchema.safeParse({ moduleOrder: ['leads', 'DROP TABLE'] }).success).toBe(false);
  });
});
