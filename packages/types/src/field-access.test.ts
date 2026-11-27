import { describe, expect, it } from 'vitest';
import { combineFieldAccess, NO_FIELD_LIMITS, orderFieldIds } from './field-access';

describe('field access handed down the tree (ADR 0096)', () => {
  it('adds the Console, the parent and the workspace’s own limits, in catalogue order', () => {
    const r = combineFieldAccess({ hidden: ['deal.amount'], locked: ['company.website'] }, { hidden: ['company.primaryEmail'], locked: ['contact.email'] }, ['rfq.pricing']);
    expect(r).toEqual({ hidden: ['company.primaryEmail', 'deal.amount', 'rfq.pricing'], locked: ['company.website', 'contact.email'] });
  });

  it('never opens below what is hidden or locked above; a hidden field is not also locked', () => {
    const r = combineFieldAccess({ hidden: ['company.website'], locked: ['company.primaryEmail'] }, { hidden: ['company.primaryEmail'], locked: [] });
    expect(r).toEqual({ hidden: ['company.primaryEmail', 'company.website'], locked: [] });
    expect(combineFieldAccess(NO_FIELD_LIMITS, {})).toEqual(NO_FIELD_LIMITS);
  });

  it('drops unknown ids and repeats', () => {
    expect(orderFieldIds(['nope', 'deal.amount', 'company.notes', 'deal.amount'])).toEqual(['company.notes', 'deal.amount']);
  });
});
