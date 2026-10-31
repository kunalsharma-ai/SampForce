import { COMPANY_SIZES, type CompanySize, type ProviderPerson, type ProviderSearchInput, SAMPLE_DOMAIN_SUFFIX } from '@dealflow/types';
import { createHash } from 'node:crypto';

/**
 * Mock Mode: what the prospect search returns while no APOLLO_API_KEY is set. Every company is on the reserved
 * ".example" top-level domain (RFC 2606), so no sample address can ever reach a real mailbox, and every person is
 * flagged sample. Results are deterministic for the same search, so screens and tests are repeatable. These are not
 * real people and DealFlow never presents them as such.
 */
const FIRST = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Quinn', 'Rowan', 'Harper', 'Emerson', 'Sasha', 'Kai', 'Noor', 'Arun', 'Mei', 'Tomas', 'Lena'];
const LAST = ['Sample', 'Example', 'Demo', 'Placeholder', 'Testwood', 'Mockford', 'Trialson', 'Previewer'];
const TITLES = ['Head of Operations', 'VP Sales', 'Procurement Manager', 'Chief Technology Officer', 'Marketing Director', 'Logistics Lead', 'Finance Manager', 'Founder and CEO'];
const INDUSTRIES = ['Logistics', 'Software', 'Retail', 'Manufacturing', 'Healthcare', 'Financial services'];
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Germany', 'Singapore', 'Australia'];

function seedOf(s: string): number {
  return createHash('sha256').update(s).digest().readUInt32BE(0);
}

/** "acme.com" → label "acme", sample domain "acme.example". */
function sampleCompany(domain: string | undefined, n: number): { name: string; domain: string } {
  const label = (domain ?? `sample-company-${n + 1}`).replace(/\..*$/, '').replace(/[^a-z0-9-]/gi, '').toLowerCase() || `sample-company-${n + 1}`;
  const name = label.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  return { name: `${name} (sample)`, domain: `${label}${SAMPLE_DOMAIN_SUFFIX}` };
}

export function sampleSearch(input: ProviderSearchInput): { people: ProviderPerson[]; hasMore: boolean } {
  const key = JSON.stringify({ ...input, page: 0 });
  const total = 3 * 12;
  const people: ProviderPerson[] = [];
  // Names are unique within one search, so sample people never look like duplicates of each other.
  const offset = seedOf(key) % LAST.length;
  for (let i = (input.page - 1) * 12; i < Math.min(total, input.page * 12); i++) {
    const r = seedOf(`${key}:${i}`);
    const company = sampleCompany(input.domains[i % Math.max(1, input.domains.length)], Math.floor(i / 4));
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(Math.floor(i / FIRST.length) + offset) % LAST.length]!;
    const size: CompanySize = input.sizes[i % Math.max(1, input.sizes.length)] ?? COMPANY_SIZES[(r >>> 8) % COMPANY_SIZES.length]!;
    people.push({
      providerId: `sample_${createHash('sha256').update(`${key}:${i}`).digest('hex').slice(0, 16)}`,
      fullName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      title: input.titles[i % Math.max(1, input.titles.length)] ?? TITLES[(r >>> 12) % TITLES.length]!,
      companyName: company.name,
      domain: company.domain,
      industry: INDUSTRIES[(r >>> 16) % INDUSTRIES.length]!,
      country: input.countries[i % Math.max(1, input.countries.length)] ?? COUNTRIES[(r >>> 20) % COUNTRIES.length]!,
      companySize: size,
      email: null,
      emailStatus: null,
      sample: true,
    });
  }
  return { people, hasMore: input.page * 12 < total };
}

/** The sample address for a sample person (on a .example domain). Status stays "unknown": nothing was checked. */
export function sampleEmail(p: { firstName: string | null; lastName: string | null; fullName: string; domain: string | null }): string {
  const local = [p.firstName, p.lastName].filter(Boolean).join('.') || p.fullName.replace(/\s+/g, '.');
  return `${local.toLowerCase().replace(/[^a-z.]/g, '')}@${p.domain?.endsWith(SAMPLE_DOMAIN_SUFFIX) ? p.domain : `sample${SAMPLE_DOMAIN_SUFFIX}`}`;
}
