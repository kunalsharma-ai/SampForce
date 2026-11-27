import { describe, expect, it } from 'vitest';
import { defaultPlanFeatures, featureForPath, FEATURE_BY_KEY, withParents } from './features';
import { PLAN_CODES } from './plans';
import { parsePlanEntitlements } from './plans';

describe('Leads and Accounts pages (ADR 0082)', () => {
  it('are in no plan until the Console Admin switches them on', () => {
    for (const plan of PLAN_CODES) {
      expect(defaultPlanFeatures(plan)).not.toContain('leads_section');
      expect(defaultPlanFeatures(plan)).not.toContain('accounts_section');
    }
    // A plan list saved by an older release does not gain them either.
    expect(parsePlanEntitlements('enterprise_plus', { features: ['lead_management'], catalogVersion: 1 }).features).not.toContain('leads_section');
  });

  it('gate the Leads list and the Accounts page, while a lead’s own page still opens', () => {
    expect(featureForPath('/app/leads')).toBe('leads_section');
    expect(featureForPath('/app/leads/abc123')).toBe('lead_management');
    expect(featureForPath('/app/accounts')).toBe('accounts_section');
    expect(featureForPath('/app/companies')).toBe('account_management');
    expect(featureForPath('/app/companies/x')).toBe('account_management');
  });

  it('go away with the module they belong to', () => {
    expect(FEATURE_BY_KEY.leads_section.optIn).toBe(true);
    expect(withParents(['leads_section', 'accounts_section', 'account_management'])).toEqual(['accounts_section', 'account_management']);
  });
});
