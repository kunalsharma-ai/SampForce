import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../common/env';

export interface ProviderEmail {
  email: string;
  name: string | null;
  position: string | null;
  confidence: number | null;
}

/**
 * Optional data provider: Hunter.io's Domain Search and Email Finder, with the customer's own HUNTER_API_KEY.
 * Built against Hunter's published v2 API and tested against a local stand-in only; not yet run with a real key.
 */
@Injectable()
export class HunterClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get configured(): boolean {
    return !!this.env.HUNTER_API_KEY;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const q = new URLSearchParams({ ...params, api_key: this.env.HUNTER_API_KEY! });
    const res = await fetch(`${this.env.HUNTER_API_BASE_URL}${path}?${q}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Hunter answered ${res.status}`);
    return ((await res.json()) as { data: T }).data;
  }

  /** People Hunter knows at a domain, or the company's domain when only its name is known. */
  async domainSearch(by: { domain: string } | { company: string }): Promise<{ domain: string | null; emails: ProviderEmail[] }> {
    const data = await this.get<{ domain?: string; emails?: { value: string; first_name?: string | null; last_name?: string | null; position?: string | null; confidence?: number | null }[] }>(
      '/domain-search',
      { ...by, limit: '25' },
    );
    return {
      domain: data.domain ?? null,
      emails: (data.emails ?? []).map((e) => ({
        email: e.value.toLowerCase(),
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
        position: e.position ?? null,
        confidence: e.confidence ?? null,
      })),
    };
  }

  async emailFinder(domain: string, firstName: string, lastName: string): Promise<ProviderEmail | null> {
    const data = await this.get<{ email?: string | null; score?: number | null; position?: string | null }>('/email-finder', { domain, first_name: firstName, last_name: lastName });
    return data.email ? { email: data.email.toLowerCase(), name: `${firstName} ${lastName}`, position: data.position ?? null, confidence: data.score ?? null } : null;
  }
}
