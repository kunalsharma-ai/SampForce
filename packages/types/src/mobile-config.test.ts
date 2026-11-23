import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from './features';
import { PERMISSIONS } from './permissions';
import { MOBILE_DASHBOARD_CARD_DEFS, defaultMobileConfig, mobileAppConfigSchema, normalizeMobileConfig, resolveMobileConfig, type MobileAppConfig } from './mobile-config';

const everything = { features: [...FEATURE_KEYS], permissions: [...PERMISSIONS] };
const clone = (c: MobileAppConfig) => JSON.parse(JSON.stringify(c)) as MobileAppConfig;

describe('mobile configuration (ADR 0072)', () => {
  it('has a default that passes its own schema and normalises to itself', () => {
    const d = defaultMobileConfig();
    expect(mobileAppConfigSchema.safeParse(d).success).toBe(true);
    expect(normalizeMobileConfig(d)).toEqual(d);
  });

  it('hides sensitive fields from Executives by default and never lets anyone change read-only fields', () => {
    const d = defaultMobileConfig();
    expect(d.fields.deals.amount.EXECUTIVE.view).toBe(false);
    expect(d.fields.deals.amount.MANAGER.view).toBe(true);
    expect(d.fields.companies.leadNumber.SUPER).toEqual({ view: true, edit: false, create: false, delete: false });
    expect(d.modules.companies.levels.EXECUTIVE.delete).toBe(false);
    expect(d.modules.companies.levels.SUPER.delete).toBe(true);
  });

  it('makes view the floor and keeps required modules and fields', () => {
    const c = clone(defaultMobileConfig());
    c.fields.companies.website.EXECUTIVE = { view: false, edit: true, create: true, delete: true };
    c.fields.companies.name.EXECUTIVE = { view: false, edit: true, create: true, delete: true };
    c.modules.profile.enabled = false;
    c.modules.deals.levels.MANAGER = { view: false, create: true, edit: true, delete: true };
    c.modules.reports.levels.SUPER = { view: true, create: true, edit: true, delete: true };
    const n = normalizeMobileConfig(c);
    expect(n.fields.companies.website.EXECUTIVE).toEqual({ view: false, edit: false, create: false, delete: false });
    expect(n.fields.companies.name.EXECUTIVE).toEqual({ view: true, edit: true, create: true, delete: false });
    expect(n.modules.profile.enabled).toBe(true);
    expect(n.modules.deals.levels.MANAGER).toEqual({ view: false, create: false, edit: false, delete: false });
    expect(n.modules.reports.levels.SUPER).toEqual({ view: true, create: false, edit: false, delete: false });
  });

  it('keeps tabs to enabled modules and dashboard cards to the levels they suit', () => {
    const c = clone(defaultMobileConfig());
    c.modules.deals.enabled = false;
    c.navigation.SUPER = ['deals', 'dashboard', 'dashboard', 'chat'];
    c.dashboard.EXECUTIVE = [{ card: 'organisation_performance', showChart: true }, { card: 'my_tasks', showChart: false }, { card: 'my_tasks', showChart: true }];
    const n = normalizeMobileConfig(c);
    expect(n.navigation.SUPER).toEqual(['dashboard', 'chat']);
    expect(n.dashboard.EXECUTIVE).toEqual([{ card: 'my_tasks', showChart: false }]);
  });

  it('resolves only what the level, plan and role allow', () => {
    const d = defaultMobileConfig();
    const exec = resolveMobileConfig(d, { level: 'EXECUTIVE', ...everything });
    expect(exec.fields.deals?.amount).toBeUndefined();
    expect(exec.fields.deals?.name).toEqual({ edit: true, create: true, delete: false });
    expect(exec.modules.find((m) => m.key === 'companies')).toEqual({ key: 'companies', create: true, edit: true, delete: false });
    expect(exec.tabs).toEqual(['dashboard', 'companies', 'follow_ups', 'tasks', 'profile']);
    expect(exec.more).toContain('chat');

    // No chat in the plan: no chat module, tab or chat switch. Read-only role: nothing can be changed.
    const plain = resolveMobileConfig(d, { level: 'MANAGER', features: FEATURE_KEYS.filter((f) => f !== 'team_chat' && f !== 'reports'), permissions: ['dashboard:read', 'companies:read'] });
    expect(plain.modules.map((m) => m.key)).toEqual(['dashboard', 'companies', 'targets', 'notifications', 'profile']);
    expect(plain.modules.find((m) => m.key === 'companies')).toEqual({ key: 'companies', create: false, edit: false, delete: false });
    expect(plain.fields.companies?.website).toEqual({ edit: false, create: false, delete: false });
    expect(plain.chat.enabled).toBe(false);
    expect(plain.tabs).toEqual(['dashboard', 'companies', 'profile']);
    const open = new Set(plain.modules.map((m) => m.key));
    expect(plain.dashboard.length).toBeGreaterThan(0);
    expect(plain.dashboard.every((c) => open.has(MOBILE_DASHBOARD_CARD_DEFS[c.card].module))).toBe(true);
    expect(plain.dashboard.map((c) => c.card)).not.toContain('my_tasks');
  });

  it('applies the workspace’s features and action grants (ADR 0071)', () => {
    const d = defaultMobileConfig();
    // A workspace without deals, and allowed only to view companies.
    const r = resolveMobileConfig(d, { level: 'EXECUTIVE', features: FEATURE_KEYS.filter((f) => f !== 'opportunity_management'), permissions: [...PERMISSIONS], actions: { CRM: ['view'], Communication: ['view', 'create', 'edit'] } });
    expect(r.modules.map((m) => m.key)).not.toContain('deals');
    expect(r.modules.find((m) => m.key === 'companies')).toEqual({ key: 'companies', create: false, edit: false, delete: false });
    expect(r.modules.find((m) => m.key === 'tasks')).toEqual({ key: 'tasks', create: true, edit: true, delete: false });
    expect(r.fields.companies?.website).toEqual({ edit: false, create: false, delete: false });
  });

  it('turns notifications off as a whole', () => {
    const c = clone(defaultMobileConfig());
    c.notifications.enabled = false;
    expect(resolveMobileConfig(normalizeMobileConfig(c), { level: 'SUPER', ...everything }).notifications).toEqual({ enabled: false, types: [] });
  });

  it('refuses a logo that is not a small image', () => {
    const c = clone(defaultMobileConfig());
    c.branding.logoDataUrl = 'data:text/html;base64,PGgxPg==';
    expect(mobileAppConfigSchema.safeParse(c).success).toBe(false);
    c.branding.logoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(mobileAppConfigSchema.safeParse(c).success).toBe(true);
  });
});
