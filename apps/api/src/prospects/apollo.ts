import { Inject, Injectable } from '@nestjs/common';
import { companySizeFrom, type EmailStatus, type ProviderPerson, type ProviderSearchInput } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';

/** Apollo's employee-count filter takes "min,max" ranges. */
const APOLLO_SIZES: Record<string, string> = {
  '1-10': '1,10', '11-50': '11,50', '51-200': '51,200', '201-500': '201,500', '501-1000': '501,1000', '1001-5000': '1001,5000', '5001+': '5001,1000000',
};
const PER_PAGE = 25;

type ApolloOrg = { name?: string | null; primary_domain?: string | null; website_url?: string | null; industry?: string | null; estimated_num_employees?: number | null };
type ApolloPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  name?: string | null;
  title?: string | null;
  country?: string | null;
  email?: string | null;
  email_status?: string | null;
  organization?: ApolloOrg | null;
};

/** Apollo's email_status onto SampForce's: only "verified" counts as verified. */
export function apolloEmailStatus(s: string | null | undefined): EmailStatus | null {
  if (!s) return null;
  if (s === 'verified') return 'valid';
  if (s === 'unverified' || s === 'extrapolated' || s === 'likely to engage') return 'needs_verification';
  return 'unknown';
}

function domainOf(org: ApolloOrg | null | undefined): string | null {
  const raw = org?.primary_domain || org?.website_url;
  if (!raw) return null;
  return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
}

export function fromApollo(p: ApolloPerson): ProviderPerson {
  const last = p.last_name || p.last_name_obfuscated || null;
  return {
    providerId: String(p.id ?? ''),
    fullName: p.name || [p.first_name, last].filter(Boolean).join(' ') || 'Unknown',
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    title: p.title ?? null,
    companyName: p.organization?.name ?? null,
    domain: domainOf(p.organization),
    industry: p.organization?.industry ?? null,
    country: p.country ?? null,
    companySize: companySizeFrom(p.organization?.estimated_num_employees ?? undefined) ?? null,
    email: p.email ? p.email.toLowerCase() : null,
    emailStatus: p.email ? apolloEmailStatus(p.email_status) : null,
    sample: false,
  };
}

/**
 * Apollo.io, with the customer's own APOLLO_API_KEY, called only from the backend. Built from Apollo's published
 * API documentation (People API Search: POST /mixed_people/api_search, which returns no email addresses; Bulk People
 * Enrichment: POST /people/bulk_match, up to 10 people per call, which can use credits). Tested against a local
 * stand-in only; it has not been run with a real key, so it shows as Pending Configuration until a live call works.
 */
@Injectable()
export class ApolloClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get configured(): boolean {
    return !!this.env.APOLLO_API_KEY;
  }

  private async post<T>(path: string, body: object, query: Record<string, string> = {}): Promise<T> {
    const q = new URLSearchParams(query).toString();
    const res = await fetch(`${this.env.APOLLO_API_BASE_URL}${path}${q ? `?${q}` : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-api-key': this.env.APOLLO_API_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new ProviderError('Apollo refused the API key or its scope. Check APOLLO_API_KEY.', res.status);
    if (res.status === 429) throw new ProviderError('Apollo rate limit reached. Try again later.', res.status);
    if (!res.ok) throw new ProviderError(`Apollo answered ${res.status}.`, res.status);
    return (await res.json()) as T;
  }

  async search(input: ProviderSearchInput): Promise<{ people: ProviderPerson[]; hasMore: boolean }> {
    const body: Record<string, unknown> = { page: input.page, per_page: PER_PAGE };
    if (input.domains.length) body.q_organization_domains_list = input.domains;
    if (input.titles.length) body.person_titles = input.titles;
    if (input.countries.length) body.person_locations = input.countries;
    if (input.sizes.length) body.organization_num_employees_ranges = input.sizes.map((s) => APOLLO_SIZES[s]);
    if (input.keywords) body.q_keywords = input.keywords;
    const data = await this.post<{ people?: ApolloPerson[]; pagination?: { total_pages?: number }; total_entries?: number }>('/mixed_people/api_search', body);
    const people = (data.people ?? []).filter((p) => p.id).map(fromApollo);
    const totalPages = data.pagination?.total_pages;
    return { people, hasMore: totalPages !== undefined ? input.page < totalPages : people.length === PER_PAGE };
  }

  /** One people search for a single result, to prove the key works. It reveals no email addresses. */
  async check(): Promise<string> {
    const data = await this.post<{ people?: ApolloPerson[]; pagination?: { total_entries?: number }; total_entries?: number }>('/mixed_people/api_search', { q_organization_domains_list: ['apollo.io'], page: 1, per_page: 1 });
    return `People search answered with ${data.people?.length ?? 0} result${data.people?.length === 1 ? '' : 's'}.`;
  }

  /** Email addresses for people found by search. Personal emails are never requested. */
  async reveal(ids: string[]): Promise<Map<string, { email: string; emailStatus: EmailStatus | null }>> {
    const out = new Map<string, { email: string; emailStatus: EmailStatus | null }>();
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const data = await this.post<{ matches?: (ApolloPerson | null)[] }>('/people/bulk_match', { details: batch.map((id) => ({ id })) }, { reveal_personal_emails: 'false', reveal_phone_number: 'false' });
      for (const m of data.matches ?? []) {
        if (m?.id && m.email) out.set(String(m.id), { email: m.email.toLowerCase(), emailStatus: apolloEmailStatus(m.email_status) });
      }
    }
    return out;
  }
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
