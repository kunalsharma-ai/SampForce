import { describe, expect, it } from 'vitest';
import { companyNameKey, defaultLeadPrefix, flagEmoji, formatLeadNumber, GEO_COUNTRIES, geoCountry, linkedinKey, matchKeys } from './company-crm';

describe('company-centric CRM helpers', () => {
  it('derives the lead prefix from the workspace initials', () => {
    expect(defaultLeadPrefix('Frequent Research Fieldwork Solutions')).toBe('FRFS');
    expect(defaultLeadPrefix('Acme')).toBe('ACME');
    expect(defaultLeadPrefix('  ')).toBe('LEAD');
    expect(formatLeadNumber('FRFS', 7, 2)).toBe('FRFS07');
    expect(formatLeadNumber('FRFS', 123, 2)).toBe('FRFS123');
  });

  it('matches company names whatever their legal suffix or case', () => {
    expect(companyNameKey('Acme Pvt. Ltd.')).toBe('acme');
    expect(companyNameKey('ACME')).toBe('acme');
    expect(companyNameKey('Société Générale S.A.')).toBe('societe generale');
    expect(companyNameKey('The Acme Company')).toBe('acme');
  });

  it('builds match keys from links, emails and phones', () => {
    expect(linkedinKey('https://www.linkedin.com/company/Acme-Research/about/')).toBe('company/acme-research');
    expect(matchKeys({ websites: ['https://www.acme.com/en'], emails: ['Info@Acme.com', 'x@gmail.com'], phones: ['+91 98765 43210'], emailDomains: true })).toEqual([
      'd:acme.com',
      'e:info@acme.com',
      'e:x@gmail.com',
      'p:9876543210',
    ]);
    expect(matchKeys({ emails: ['a@acme.com'] })).toEqual(['e:a@acme.com']);
  });

  it('has every country with dialling code, currency and IANA time zones', () => {
    expect(GEO_COUNTRIES.length).toBeGreaterThanOrEqual(245);
    expect(geoCountry('in')).toMatchObject({ dialCode: '91', currency: 'INR', timezones: ['Asia/Kolkata'] });
    expect(geoCountry('AE')).toMatchObject({ dialCode: '971', currency: 'AED' });
    expect(geoCountry('US')!.timezones.length).toBeGreaterThan(5);
    for (const c of GEO_COUNTRIES) {
      expect(c.dialCode).toMatch(/^\d{1,4}$/);
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(c.timezones.length).toBeGreaterThan(0);
    }
    expect(flagEmoji('IN')).toBe('🇮🇳');
  });
});
