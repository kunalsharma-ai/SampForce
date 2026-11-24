import { describe, expect, it } from 'vitest';
import type { Candidate } from '../src/crm/enrichment/candidates';
import { countryIn, sizeBand, singleTimezone } from '../src/crm/enrichment/candidates';
import { merge, type StoredFill, undo, userEdits } from '../src/crm/enrichment/merge';
import { pagesToRead, readWebsite } from '../src/crm/enrichment/website';
import { findItem, readItem } from '../src/crm/enrichment/wikidata';
import { ENRICH_FIELDS, socialPlatformOf } from '@dealflow/types';
import { ENRICH_SITES, wikidataAnswer } from './fixtures/company-sites';

/** Company auto-fill rules (ADR 0076), without a database: reading pages and Wikidata, and what gets written. */

const site = (host: string, path: string) => {
  const e = ENRICH_SITES[host]![path]!;
  if ('redirect' in e) throw new Error('redirect');
  return { url: `https://${host}${path}`, html: e.body };
};
const values = (cands: Candidate[], field: string) => cands.filter((c) => c.field === field).map((c) => c.value);
const wikidata = async (u: string) => wikidataAnswer(new URL(u).searchParams);

describe('reading a company website', () => {
  const host = 'www.northwind-insights.example';
  const domain = 'northwind-insights.example';
  const pages = ['/', '/about-us', '/contact'].map((p) => site(host, p));
  const found = readWebsite(pages, domain, `https://${host}/contact`);

  it('finds the About and Contact pages from the home page', () => {
    expect(pagesToRead(pages[0]!, domain)).toEqual({ about: `https://${host}/about-us`, contact: `https://${host}/contact`, offices: null });
  });

  it('keeps official profiles, and skips share buttons and people’s profiles', () => {
    const links = values(found, 'socialLinks').flat() as { platform: string; url: string }[];
    expect(links.map((l) => l.platform).sort()).toEqual(['facebook', 'instagram', 'linkedin', 'x', 'youtube']);
    expect(links.find((l) => l.platform === 'linkedin')!.url).toBe('https://www.linkedin.com/company/northwind-insights');
    expect(links.some((l) => /sharer|\/in\//.test(l.url))).toBe(false);
    expect(values(found, 'linkedinUrl')).toEqual(['https://www.linkedin.com/company/northwind-insights']);
    expect(socialPlatformOf('https://www.linkedin.com/in/someone')).toBeNull();
    expect(socialPlatformOf('https://twitter.com/intent/tweet?text=hi')).toBeNull();
  });

  it('keeps role mailboxes on the company’s domain with a label, never a person’s address', () => {
    const emails = values(found, 'emails').flat() as { value: string; label: string }[];
    expect(emails).toEqual(
      expect.arrayContaining([
        { value: 'bd@northwind-insights.example', label: 'Sales and business development' },
        { value: 'hr@northwind-insights.example', label: 'HR and careers' },
        { value: 'info@northwind-insights.example', label: 'General' },
      ]),
    );
    expect(emails.some((e) => e.value.startsWith('priya'))).toBe(false);
    // The general mailbox is the primary one.
    expect(values(found, 'primaryEmail')).toEqual(['info@northwind-insights.example']);
  });

  it('reads phones from links (with their readable spacing) and from labelled text', () => {
    const phones = (values(found, 'phones').flat() as { value: string }[]).map((p) => p.value);
    expect(phones).toEqual(expect.arrayContaining(['+44 20 7946 0958', '+91 20 4000 1234']));
  });

  it('reads the head office and the other offices', () => {
    expect(values(found, 'address')).toEqual(['4th Floor, Meridian Tower, 12 Harbour Road']);
    expect(values(found, 'city')).toEqual(['Pune']);
    expect(values(found, 'state')).toEqual(['Maharashtra']);
    expect(values(found, 'postalCode')).toEqual(['411001']);
    expect(values(found, 'country')).toEqual(['IN']);
    expect(values(found, 'timezone')).toEqual(['Asia/Kolkata']);
    expect(values(found, 'headquarters')).toEqual(['Pune, India']);
    const others = values(found, 'addresses')[0] as { label: string; country: string; city: string | null }[];
    expect(others.map((o) => [o.label, o.country])).toEqual([
      ['UK Office', 'GB'],
      ['US Office', 'US'],
      ['Singapore Office', 'SG'],
      ['UAE Office', 'AE'],
    ]);
    expect(others[0]).toMatchObject({ city: 'London', postalCode: 'EC4A 2AB', address: 'Unit 7, 221 Fleet Lane' });
    expect(values(found, 'branchCount')).toEqual([5]);
  });

  it('reads services, industries served, certifications, the founding year and the head count', () => {
    expect(values(found, 'services')[0]).toEqual(['Online Surveys', 'B2B Research', 'Healthcare Research', 'Data Processing', 'Panel Management']);
    expect(values(found, 'industriesServed')[0]).toEqual(['Healthcare', 'Technology', 'Financial Services']);
    expect(values(found, 'certifications')[0]).toEqual(['ISO 20252:2019', 'ISO 27001', 'ESOMAR member']);
    expect(values(found, 'foundedYear')).toEqual([2009]);
    expect(values(found, 'employeeCount')).toEqual([450]);
    expect(values(found, 'companySize')).toEqual(['201-500']);
  });

  it('marks guesses as low confidence and page text as medium', () => {
    expect(found.find((c) => c.field === 'industry')).toMatchObject({ value: 'Market research', confidence: 'low' });
    expect(found.find((c) => c.field === 'foundedYear')).toMatchObject({ confidence: 'medium', url: `https://${host}/about-us` });
    expect(found.find((c) => c.field === 'overview')).toMatchObject({ source: 'WEBSITE', confidence: 'high' });
  });

  it('trusts schema.org data the company published', () => {
    const g = readWebsite([site('globex-analytics.example', '/')], 'globex-analytics.example', null);
    const s = (f: string) => g.find((c) => c.field === f && c.source === 'SCHEMA_ORG');
    expect(s('legalName')).toMatchObject({ value: 'Globex Analytics plc', confidence: 'high' });
    expect(s('foundedYear')!.value).toBe(1999);
    expect(s('employeeCount')!.value).toBe(11800);
    expect(s('city')!.value).toBe('London');
    expect(s('postalCode')!.value).toBe('SE1 9PG');
    expect(s('emails')!.value).toEqual([
      { value: 'contact@globex-analytics.example', label: 'General' },
      { value: 'sales@globex-analytics.example', label: 'Sales' },
    ]);
    expect(s('moreDetails')!.value).toEqual([{ label: 'Slogan', value: 'Know your audience' }]);
  });

  it('knows countries, size bands and single time zones', () => {
    expect(countryIn('500 Market Street, San Francisco, CA 94105, USA')?.code).toBe('US');
    expect(countryIn('Gurugram, Haryana 122002, India')?.code).toBe('IN');
    expect(countryIn('no country here')).toBeNull();
    expect(sizeBand(7)).toBe('1-10');
    expect(sizeBand(12000)).toBe('5001+');
    expect(singleTimezone('IN')).toBe('Asia/Kolkata');
    expect(singleTimezone('US')).toBeNull();
  });
});

describe('reading Wikidata', () => {
  it('uses an item only when its official website is the company’s domain', async () => {
    expect((await findItem(wikidata, { name: 'Globex Analytics', domain: 'globex-analytics.example' }))?.entity.id).toBe('Q990001');
    // Same name, other domain: not this company.
    expect(await findItem(wikidata, { name: 'Globex Analytics', domain: 'globex.example' })).toBeNull();
  });

  it('reads the facts, with the current CEO and the latest head count', async () => {
    const hit = (await findItem(wikidata, { name: 'Globex Analytics', domain: 'globex-analytics.example' }))!;
    const facts = await readItem(wikidata, hit.entity, hit.byName);
    const v = (f: string) => facts.find((c) => c.field === f)?.value;
    expect(v('foundedYear')).toBe(1998);
    expect(v('employeeCount')).toBe(12000);
    expect(v('industry')).toBe('Market research');
    expect(v('country')).toBe('GB');
    expect(v('headquarters')).toBe('London, United Kingdom');
    expect(v('founders')).toEqual(['Hana Okafor']);
    expect(v('ceo')).toBe('Mateo Lindqvist');
    expect(v('parentCompanyName')).toBe('Globex Holdings');
    expect(v('companyType')).toBe('Public company');
    expect(v('moreDetails')).toEqual([{ label: 'Stock ticker', value: 'London Stock Exchange: GBXA' }]);
    expect(v('socialLinks')).toEqual([
      { platform: 'linkedin', url: 'https://www.linkedin.com/company/globex-analytics' },
      { platform: 'x', url: 'https://x.com/globexanalytics' },
    ]);
    expect(facts.every((c) => c.source === 'WIKIDATA' && c.url === 'https://www.wikidata.org/wiki/Q990001')).toBe(true);
  });

  it('finds a company saved with a name only when exactly one company has that exact name', async () => {
    const hit = await findItem(wikidata, { name: 'Umbrella Dynamics', domain: null });
    expect(hit).toMatchObject({ entity: { id: 'Q990002' }, byName: true });
    const facts = await readItem(wikidata, hit!.entity, true);
    // A website found by name is for people to check.
    expect(facts.find((c) => c.field === 'website')).toMatchObject({ value: 'https://umbrella-dynamics.example', confidence: 'medium' });
    expect(await findItem(wikidata, { name: 'Umbrella', domain: null })).toBeNull();
  });
});

describe('what auto-fill writes', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const c = (field: Candidate['field'], value: unknown, source: Candidate['source'] = 'WEBSITE', confidence: Candidate['confidence'] = 'high', url = 'https://acme.example/'): Candidate =>
    ({ field, value, source, url, confidence }) as Candidate;

  it('fills only empty fields and keeps the source of each value', () => {
    const r = merge({ fieldSources: {}, industry: 'Typed by me', foundedYear: null }, [c('industry', 'Software'), c('foundedYear', 2001)], 'run1', now);
    expect(r.data).toEqual({ foundedYear: 2001 });
    expect(r.fieldSources.foundedYear).toMatchObject({ source: 'WEBSITE', url: 'https://acme.example/', confidence: 'high', runId: 'run1', at: now.toISOString() });
    expect(r.fills.map((f) => f.field)).toEqual(['foundedYear']);
  });

  it('never writes a field someone cleared', () => {
    const r = merge({ fieldSources: { foundedYear: { source: 'USER', url: null, at: now.toISOString(), confidence: 'high', runId: null } }, foundedYear: null }, [c('foundedYear', 2001)], 'run1', now);
    expect(r.fills).toEqual([]);
  });

  it('ranks the company’s own data above Wikidata, and marks disagreement as uncertain unless the company stated it', () => {
    const official = merge({ fieldSources: {} }, [c('foundedYear', 1998, 'WIKIDATA'), c('foundedYear', 1999, 'SCHEMA_ORG')], 'r', now);
    expect(official.data.foundedYear).toBe(1999);
    expect(official.fieldSources.foundedYear).toMatchObject({ confidence: 'high', alternatives: [{ value: '1998', source: 'WIKIDATA' }] });
    const text = merge({ fieldSources: {} }, [c('foundedYear', 1998, 'WIKIDATA'), c('foundedYear', 2004, 'WEBSITE', 'medium')], 'r', now);
    expect(text.data.foundedYear).toBe(2004);
    expect(text.fieldSources.foundedYear!.confidence).toBe('uncertain');
  });

  it('adds missing list items, keeps people’s own items, and makes the found email primary only when none is set', () => {
    const before = { fieldSources: {}, primaryEmail: null, emails: [{ value: 'me@acme.example', label: null, primary: false }] };
    const r = merge(before, [c('emails', [{ value: 'me@acme.example', label: 'General' }, { value: 'sales@acme.example', label: 'Sales' }]), c('primaryEmail', 'sales@acme.example')], 'r', now);
    expect(r.data.emails).toEqual([
      { value: 'me@acme.example', label: null, primary: false },
      { value: 'sales@acme.example', label: 'Sales', primary: true },
    ]);
    expect(r.data.primaryEmail).toBe('sales@acme.example');
    expect(r.fieldSources.emails!.items).toEqual(['sales@acme.example']);
  });

  it('writes the head-office address from one source, and not at all when part of it is typed', () => {
    const cands = [c('address', '1 Main St', 'SCHEMA_ORG'), c('city', 'Leeds', 'SCHEMA_ORG'), c('city', 'York', 'WIKIDATA'), c('postalCode', 'LS1 1AA', 'SCHEMA_ORG')];
    expect(merge({ fieldSources: {} }, cands, 'r', now).data).toMatchObject({ address: '1 Main St', city: 'Leeds', postalCode: 'LS1 1AA' });
    const typed = merge({ fieldSources: {}, city: 'Bradford' }, cands, 'r', now);
    expect(typed.data).not.toHaveProperty('address');
    expect(typed.data).not.toHaveProperty('postalCode');
  });

  it('undoes a run: clears what it wrote (marked as cleared) and removes the list items it added', () => {
    const r = merge({ fieldSources: {}, emails: [] }, [c('foundedYear', 2001), c('emails', [{ value: 'info@acme.example', label: 'General' }]), c('primaryEmail', 'info@acme.example')], 'run1', now);
    const company = { ...r.data, fieldSources: r.fieldSources };
    const u = undo(company, r.fills as StoredFill[], 'run1', undefined, 'user-1', now);
    expect(u.undone.sort()).toEqual(['emails', 'foundedYear', 'primaryEmail']);
    expect(u.data).toMatchObject({ foundedYear: null, primaryEmail: null, emails: [] });
    const sources = u.data.fieldSources as Record<string, { source: string; rejected?: string[] }>;
    expect(sources.foundedYear!.source).toBe('USER');
    expect(sources.emails!.rejected).toEqual(['info@acme.example']);
    // A later run adds neither again.
    const again = merge({ ...company, ...u.data }, [c('foundedYear', 2001), c('emails', [{ value: 'info@acme.example', label: 'General' }])], 'run2', now);
    expect(again.fills).toEqual([]);
  });

  it('does not undo a value someone has changed since', () => {
    const r = merge({ fieldSources: {} }, [c('foundedYear', 2001)], 'run1', now);
    const company = { foundedYear: 2005, fieldSources: { foundedYear: { source: 'USER', url: null, at: now.toISOString(), confidence: 'high', runId: null } } };
    const u = undo(company, r.fills as StoredFill[], 'run1', undefined, 'u', now);
    expect(u.undone).toEqual([]);
    expect(u.data).not.toHaveProperty('foundedYear');
  });

  it('records what people change: changed fields become theirs, removed auto items are not added back', () => {
    const before = { foundedYear: 2001, emails: [{ value: 'info@acme.example' }], fieldSources: { foundedYear: { source: 'WEBSITE', url: null, at: '', confidence: 'high', runId: 'r' }, emails: { source: 'WEBSITE', url: null, at: '', confidence: 'high', runId: 'r', items: ['info@acme.example'] } } };
    const s = userEdits(before, { foundedYear: 2003, emails: [] }, 'u1', now, ENRICH_FIELDS)!;
    expect(s.foundedYear).toMatchObject({ source: 'USER', byUserId: 'u1' });
    expect(s.emails).toMatchObject({ items: [], rejected: ['info@acme.example'] });
    expect(userEdits(before, { foundedYear: 2001 }, 'u1', now, ENRICH_FIELDS)).toBeNull();
  });
});
