import { DOMAIN_EVENT_TYPES, type DomainEventType } from '@dealflow/types';

const KNOWN = new Set<string>(DOMAIN_EVENT_TYPES);

/**
 * Maps an audit action to the domain events it publishes. Audit actions and event names mostly
 * coincide; the exceptions widen one action into several events. Bulk imports publish nothing, so an
 * import of thousands of rows never fans out into thousands of automation runs.
 */
export function domainEventsFor(action: string, metadata: Record<string, unknown> = {}): DomainEventType[] {
  switch (action) {
    case 'lead.assigned':
      return ['lead.assigned', 'lead.updated'];
    case 'deal.cloned':
      return ['deal.created'];
    case 'deal.stage_changed': {
      const status = metadata.status;
      return status === 'WON'
        ? ['deal.stage_changed', 'deal.won']
        : status === 'LOST'
          ? ['deal.stage_changed', 'deal.lost']
          : ['deal.stage_changed'];
    }
    default:
      return KNOWN.has(action) ? [action as DomainEventType] : [];
  }
}
