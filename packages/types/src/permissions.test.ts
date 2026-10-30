import { describe, expect, it } from 'vitest';
import { PERMISSIONS, SYSTEM_ROLE_DEFINITIONS, hasPermission } from './permissions';
import { registerSchema } from './auth';

describe('system roles', () => {
  it('grants owners every permission', () => {
    expect(new Set(SYSTEM_ROLE_DEFINITIONS.owner.permissions)).toEqual(new Set(PERMISSIONS));
  });

  it('keeps viewers read-only', () => {
    for (const p of SYSTEM_ROLE_DEFINITIONS.viewer.permissions) expect(p.endsWith(':read')).toBe(true);
  });

  it('does not let members manage the tenant or billing', () => {
    const member = SYSTEM_ROLE_DEFINITIONS.member.permissions;
    expect(hasPermission(member, 'tenant:manage')).toBe(false);
    expect(hasPermission(member, 'billing:manage')).toBe(false);
    expect(hasPermission(member, 'leads:write')).toBe(true);
  });

  it('only gives billing:manage to owners', () => {
    const holders = Object.entries(SYSTEM_ROLE_DEFINITIONS)
      .filter(([, r]) => r.permissions.includes('billing:manage'))
      .map(([k]) => k);
    expect(holders).toEqual(['owner']);
  });
});

describe('registerSchema', () => {
  it('normalises email and rejects weak passwords', () => {
    const ok = registerSchema.safeParse({
      name: 'Ada',
      email: '  ADA@Example.com ',
      password: 'correcthorse1',
      organizationName: 'Acme',
    });
    expect(ok.success && ok.data.email).toBe('ada@example.com');
    expect(
      registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'short', organizationName: 'Acme' })
        .success,
    ).toBe(false);
  });
});

import { PLAN_CATALOG, PLAN_CODES, PLAN_ENTITLEMENTS } from './plans';

describe('plan catalogue', () => {
  it('covers every plan code exactly once with entitlements', () => {
    expect(PLAN_CATALOG.map((p) => p.code)).toEqual([...PLAN_CODES]);
    for (const code of PLAN_CODES) expect(PLAN_ENTITLEMENTS[code]).toBeDefined();
  });

  it('makes annual billing cheaper than monthly for paid plans', () => {
    for (const p of PLAN_CATALOG) {
      if (p.monthly && p.annualMonthly) expect(p.annualMonthly).toBeLessThan(p.monthly);
    }
  });
});
