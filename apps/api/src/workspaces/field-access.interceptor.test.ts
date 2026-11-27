import { describe, expect, it } from 'vitest';
import { hiddenKeysByEntity } from '@dealflow/types';
import { createsRecord, dropHidden, stripHidden } from './field-access.interceptor';

const hidden = hiddenKeysByEntity(['company.primaryEmail', 'contact.phone', 'rfq.pricing']);

describe('field access: hiding fields in responses (R8)', () => {
  it('blanks the path record type, lists and nested record types, but not other nested objects', () => {
    const company = {
      id: 'c1',
      name: 'Kite',
      primaryEmail: 'a@kite.test',
      emails: [{ value: 'a@kite.test' }],
      owner: { name: 'Priya', email: 'priya@kite.test' },
      contacts: [{ firstName: 'Asha', phone: '+91', phoneIntl: '+91', email: 'asha@kite.test' }],
      rfqs: [{ number: 'R-1', cpi: 4, totalQuotation: 400, sampleSize: 100 }],
    };
    const out = stripHidden({ items: [company], total: 1 }, 'company', hidden) as { items: (typeof company)[]; total: number };
    const c = out.items[0]!;
    expect(c.primaryEmail).toBeNull();
    expect(c.emails).toEqual([]);
    expect(c.name).toBe('Kite');
    expect(c.owner).toEqual({ name: 'Priya', email: 'priya@kite.test' });
    expect(c.contacts[0]).toEqual({ firstName: 'Asha', phone: null, phoneIntl: null, email: 'asha@kite.test' });
    expect(c.rfqs[0]).toEqual({ number: 'R-1', cpi: null, totalQuotation: null, sampleSize: 100 });
    expect(out.total).toBe(1);
  });

  it('leaves buffers, dates and responses of other paths alone', () => {
    const buf = Buffer.from('x');
    expect(stripHidden(buf, 'company', hidden)).toBe(buf);
    const d = new Date();
    expect((stripHidden({ primaryEmail: 'x', at: d }, 'company', hidden) as { at: Date }).at).toBe(d);
    expect(stripHidden({ primaryEmail: 'x' }, null, hidden)).toEqual({ primaryEmail: 'x' });
  });

  it('drops hidden fields from an input, also inside a bulk patch', () => {
    const body = { primaryEmail: 'x', emails: [], industry: 'R', patch: { primaryEmail: 'y', city: 'Pune' } };
    dropHidden(body, 'company', hidden);
    expect(body).toEqual({ industry: 'R', patch: { city: 'Pune' } });
  });
});

describe('field access: locked fields (ADR 0096)', () => {
  it('treats only a POST to the list itself as creating a record', () => {
    expect(createsRecord('POST', '/api/v1/companies')).toBe(true);
    expect(createsRecord('POST', '/contacts')).toBe(true);
    expect(createsRecord('POST', '/api/v1/companies/c1/won')).toBe(false);
    expect(createsRecord('PATCH', '/api/v1/companies')).toBe(false);
    expect(createsRecord('POST', '/api/v1/companies/bulk')).toBe(false);
  });
});
