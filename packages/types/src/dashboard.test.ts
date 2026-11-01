import { describe, expect, it } from 'vitest';
import { completeLayout, DASHBOARD_PRESETS, DASHBOARD_WIDGETS, dashboardFilterSchema, dashboardLayoutSchema } from './dashboard';

describe('Command Center layouts', () => {
  it('ships presets that are valid and name every widget once', () => {
    for (const p of Object.values(DASHBOARD_PRESETS)) {
      expect(dashboardLayoutSchema.parse(p)).toEqual(p);
      expect(p.widgets.map((w) => w.id).sort()).toEqual([...DASHBOARD_WIDGETS].sort());
    }
  });

  it('appends widgets a stored layout does not mention, hidden', () => {
    const l = completeLayout({ preset: 'custom', widgets: [{ id: 'goal', size: 'full', hidden: false }], filters: { period: '7d' } });
    expect(l.widgets[0]).toEqual({ id: 'goal', size: 'full', hidden: false });
    expect(l.widgets).toHaveLength(DASHBOARD_WIDGETS.length);
    expect(l.widgets.slice(1).every((w) => w.hidden)).toBe(true);
  });

  it('rejects duplicate widgets, unknown widgets and bad filters', () => {
    expect(dashboardLayoutSchema.safeParse({ widgets: [{ id: 'kpis', size: 'full' }, { id: 'kpis', size: 'half' }] }).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse({ widgets: [{ id: 'globe', size: 'full' }] }).success).toBe(false);
    expect(dashboardFilterSchema.safeParse({ period: '2y' }).success).toBe(false);
    expect(dashboardFilterSchema.safeParse({ period: '30d', ownerId: 'bob' }).success).toBe(false);
    expect(dashboardFilterSchema.parse({})).toEqual({ period: '30d' });
  });
});
