import { describe, expect, it } from 'vitest';
import {
  combinedImportTargets,
  countryCodeFrom,
  customFieldKeyFor,
  customFieldLabelFor,
  editDistance,
  headingSide,
  IMPORT_FIELD_ALIASES,
  suggestMapping,
} from './import-mapping';

const COMBINED = [
  'company.name', 'company.website', 'company.linkedinUrl', 'company.industry', 'company.country', 'company.state', 'company.city', 'company.address',
  'contact.fullName', 'contact.firstName', 'contact.lastName', 'contact.email', 'contact.phone', 'contact.jobTitle', 'contact.linkedinUrl', 'contact.country',
];
const LEADS = ['fullName', 'companyName', 'jobTitle', 'email', 'phone', 'country', 'website'].map((value) => ({ value, aliases: IMPORT_FIELD_ALIASES[value] }));

describe('import column matching', () => {
  it('maps a one-row-per-employee sheet with typos and mixed case', () => {
    const headings = ['DATE', 'NO OF BRANCHES & ADDRESS', 'COUNTRY & WORKING HOURS', 'COMPANY NAME', 'WESBSITE', 'COMPANY LINKEDIN ID', 'EMPLOYEE NAME', 'EMPLOYEE DESGNATION', 'EMPLOYEE EMAIL ID'];
    expect(suggestMapping(headings, combinedImportTargets(COMBINED))).toEqual({
      'COMPANY NAME': 'company.name',
      WESBSITE: 'company.website',
      'COMPANY LINKEDIN ID': 'company.linkedinUrl',
      'EMPLOYEE NAME': 'contact.fullName',
      'EMPLOYEE DESGNATION': 'contact.jobTitle',
      'EMPLOYEE EMAIL ID': 'contact.email',
    });
  });

  it('gives bare shared headings to the company and prefixed ones to their record', () => {
    const m = suggestMapping(['Country', 'Employee Country', 'LinkedIn', 'Contact LinkedIn URL', 'Name', 'Email'], combinedImportTargets(COMBINED));
    expect(m).toEqual({ Country: 'company.country', 'Employee Country': 'contact.country', LinkedIn: 'company.linkedinUrl', 'Contact LinkedIn URL': 'contact.linkedinUrl', Name: 'contact.fullName', Email: 'contact.email' });
  });

  it('matches single-record imports by synonyms and typos, one column per field', () => {
    expect(suggestMapping(['EMPLOYEE NAME', 'Organisation', 'DESGNATION', 'E-mail ID', 'Mobile No', 'Phone'], LEADS)).toEqual({
      'EMPLOYEE NAME': 'fullName',
      Organisation: 'companyName',
      DESGNATION: 'jobTitle',
      'E-mail ID': 'email',
      Phone: 'phone',
    });
  });

  it('matches custom fields by label and leaves unrelated headings alone', () => {
    const m = suggestMapping(['Lead Sorce', 'Working hours'], [{ value: 'customFields.lead_source', label: 'Lead Source' }]);
    expect(m).toEqual({ 'Lead Sorce': 'customFields.lead_source' });
  });

  it('does not forgive typos in short names', () => {
    expect(suggestMapping(['Stat', 'Tag'], LEADS)).toEqual({});
    expect(editDistance('wesbsite', 'website')).toBe(1);
    expect(editDistance('abc', 'xyzabc', 2)).toBe(3);
  });

  it('decides which record a new column belongs to', () => {
    expect(headingSide('EMPLOYEE MOBILE')).toBe('contact');
    expect(headingSide('NO OF BRANCHES & ADDRESS')).toBe('company');
    expect(headingSide('DATE')).toBe('company');
  });

  it('makes keys and labels for new custom fields', () => {
    expect(customFieldKeyFor('NO OF BRANCHES & ADDRESS', new Set())).toBe('no_of_branches_and_address');
    expect(customFieldKeyFor('Date', new Set(['date']))).toBe('date_2');
    expect(customFieldKeyFor('2nd email', new Set())).toBe('f_2nd_email');
    expect(customFieldKeyFor('#', new Set())).toBe('field');
    expect(customFieldLabelFor('COUNTRY & WORKING HOURS')).toBe('Country & Working Hours');
    expect(customFieldLabelFor('Working hours (IST)')).toBe('Working hours (IST)');
  });

  it('reads country names, codes and abbreviations', () => {
    expect(countryCodeFrom('United States of America (USA)')).toBe('US');
    expect(countryCodeFrom('U.S.A.')).toBe('US');
    expect(countryCodeFrom('india')).toBe('IN');
    expect(countryCodeFrom('gb')).toBe('GB');
    expect(countryCodeFrom('UK')).toBe('GB');
    expect(countryCodeFrom('Atlantis')).toBeNull();
    expect(countryCodeFrom('')).toBeNull();
  });
});
