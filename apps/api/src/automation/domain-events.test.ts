import { describe, expect, it } from 'vitest';
import { domainEventsFor } from './domain-events';

describe('domainEventsFor', () => {
  it('publishes known actions under the same name', () => {
    expect(domainEventsFor('lead.created')).toEqual(['lead.created']);
    expect(domainEventsFor('task.completed')).toEqual(['task.completed']);
  });

  it('adds won and lost events to stage changes', () => {
    expect(domainEventsFor('deal.stage_changed', { status: 'WON' })).toEqual(['deal.stage_changed', 'deal.won']);
    expect(domainEventsFor('deal.stage_changed', { status: 'LOST' })).toEqual(['deal.stage_changed', 'deal.lost']);
    expect(domainEventsFor('deal.stage_changed', { status: 'OPEN' })).toEqual(['deal.stage_changed']);
  });

  it('treats assignment as an update too, and a clone as a new deal', () => {
    expect(domainEventsFor('lead.assigned')).toEqual(['lead.assigned', 'lead.updated']);
    expect(domainEventsFor('deal.cloned')).toEqual(['deal.created']);
  });

  it('ignores security, settings and bulk actions', () => {
    for (const a of ['auth.login', 'member.role_changed', 'data.imported', 'data.exported', 'deal.bulk_updated', 'tenant.updated']) {
      expect(domainEventsFor(a)).toEqual([]);
    }
  });
});
