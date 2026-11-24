import { describe, expect, it } from 'vitest';
import { FEATURES, FEATURE_KEYS } from './features';
import { parsePlanEntitlements } from './plans';
import { actionAllowed, allActions, defaultChildActions, intersectActions, intersectFeatures, parseActionGrants } from './workspaces';

describe('workspace inheritance (ADR 0071)', () => {
  it('never gives a child a feature its parent lacks, and drops orphaned subfeatures', () => {
    expect(intersectFeatures(['lead_management', 'lead_assignment'], ['lead_assignment', 'rfqs', 'lead_management'])).toEqual(['lead_management', 'lead_assignment']);
    expect(intersectFeatures(['lead_assignment'], ['lead_assignment'])).toEqual([]);
  });

  it('intersects actions per module and keeps a parent’s feature-level narrowing', () => {
    const parent = { CRM: ['view', 'create', 'edit'] as const, lead_management: ['view'] as const };
    const child = intersectActions({ CRM: [...parent.CRM], lead_management: [...parent.lead_management] }, { CRM: ['view', 'delete', 'edit'] });
    expect(child.CRM).toEqual(['view', 'edit']);
    expect(actionAllowed(child, 'lead_management', 'edit')).toBe(false);
    expect(actionAllowed(child, 'account_management', 'edit')).toBe(true);
    expect(actionAllowed(child, 'account_management', 'delete')).toBe(false);
  });

  it('gives executives no administration beyond viewing by default', () => {
    const exec = defaultChildActions('EXECUTIVE', allActions());
    expect(exec.Administration).toEqual(['view']);
    expect(exec.CRM).toEqual(['view', 'create', 'edit', 'reports']);
    expect(defaultChildActions('MANAGER', allActions()).CRM).not.toContain('configure');
  });

  it('never turns delete on by default, at any level', () => {
    for (const level of ['MANAGER', 'EXECUTIVE'] as const) {
      const grants = defaultChildActions(level, allActions());
      expect(Object.values(grants).some((list) => list?.includes('delete'))).toBe(false);
    }
  });

  it('reads stored grants leniently', () => {
    expect(parseActionGrants({ CRM: ['view', 'fly'], nonsense: ['view'] })).toEqual({ CRM: ['view'] });
    expect(parseActionGrants(null)).toEqual({});
  });
});

describe('feature catalogue (ADR 0071)', () => {
  it('has unique keys, known parents and a definition for every key', () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
    expect(FEATURES.map((f) => f.key).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const f of FEATURES) if (f.parent) expect(FEATURE_KEYS).toContain(f.parent);
  });

  it('adds new core modules to plan lists saved before they existed, but not to lists saved since', () => {
    const old = parsePlanEntitlements('free', { features: ['rfqs'] });
    expect(old.features).toContain('lead_management');
    expect(old.features).toContain('rfqs');
    // A list saved at version 2 gets what version 3 added (company auto-fill, ADR 0076), but not the version 2 modules.
    const v2 = parsePlanEntitlements('free', { features: ['rfqs'], catalogVersion: 2 });
    expect(v2.features).toEqual(['rfqs', 'company_enrichment']);
    const fresh = parsePlanEntitlements('free', { features: ['rfqs'], catalogVersion: 3 });
    expect(fresh.features).toEqual(['rfqs']);
  });
});
