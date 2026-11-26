import type { Leader, MoreDetail, SocialLink, SocialPlatform } from '@dealflow/types';
import { type Candidate, candidate, singleTimezone, sizeBand } from './candidates';

/*
 * Wikidata (ADR 0076): the free, openly licensed (CC0) knowledge base. Larger companies have an item with their
 * founding date, industry, head office, head count, founders, CEO, parent and official profiles. An item is only used
 * when its official website (P856) is the company's own domain, so a company is never mixed up with another one of
 * the same name. A company saved with a name only gets an item only when exactly one item has that exact name and a
 * website; the website it gives is then marked medium confidence for people to check.
 */

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const ITEM_URL = (id: string) => `https://www.wikidata.org/wiki/${id}`;

type Json = Record<string, unknown>;
export type JsonGet = (url: string) => Promise<unknown>;

interface Snak {
  snaktype?: string;
  datavalue?: { value?: unknown; type?: string };
}
interface Claim {
  mainsnak?: Snak;
  rank?: 'preferred' | 'normal' | 'deprecated';
  qualifiers?: Record<string, Snak[]>;
}
interface Entity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
}

const api = (params: Record<string, string>) => `${WIKIDATA_API}?${new URLSearchParams({ format: 'json', ...params }).toString()}`;

/** The company's item: by name, checked against the website; else by its website directly. */
export async function findItem(get: JsonGet, company: { name: string; domain: string | null }): Promise<{ entity: Entity; byName: boolean } | null> {
  const ids = new Set<string>();
  // Searched without its legal ending ("Pureprofile Ltd" -> "Pureprofile"); names compare without case or endings.
  const short = withoutLegalEnding(company.name) || company.name;
  const search = (await get(api({ action: 'wbsearchentities', search: short.slice(0, 200), language: 'en', uselang: 'en', type: 'item', limit: '7' }))) as Json | null;
  const hits = Array.isArray(search?.search) ? (search.search as Json[]) : [];
  for (const h of hits) if (typeof h.id === 'string' && /^Q\d+$/.test(h.id)) ids.add(h.id);
  const exactName = new Set(hits.filter((h) => typeof h.label === 'string' && sameName(h.label, company.name)).map((h) => String(h.id)));
  if (company.domain) {
    // Items whose official website is exactly the domain (with or without www, http or https).
    const variants = [`https://${company.domain}`, `https://www.${company.domain}`, `http://${company.domain}`, `http://www.${company.domain}`].flatMap((v) => [v, `${v}/`]);
    const q = (await get(api({ action: 'query', list: 'search', srsearch: `haswbstatement:${variants.map((v) => `P856=${v}`).join('|')}`, srlimit: '5', srnamespace: '0' }))) as Json | null;
    const found = ((q?.query as Json | undefined)?.search as Json[] | undefined) ?? [];
    for (const f of found) if (typeof f.title === 'string' && /^Q\d+$/.test(f.title)) ids.add(f.title);
  }
  if (!ids.size) return null;
  const entities = await getEntities(get, [...ids].slice(0, 12), 'labels|descriptions|claims');
  if (company.domain) {
    const match = entities.find((e) => websites(e).some((w) => w === company.domain));
    return match ? { entity: match, byName: false } : null;
  }
  // Name only: exactly one item with this exact name that is a company with a website.
  const named = entities.filter((e) => exactName.has(e.id) && websites(e).length && !isHuman(e));
  return named.length === 1 ? { entity: named[0]!, byName: true } : null;
}

async function getEntities(get: JsonGet, ids: string[], props: string): Promise<Entity[]> {
  if (!ids.length) return [];
  const res = (await get(api({ action: 'wbgetentities', ids: ids.join('|'), props, languages: 'en' }))) as Json | null;
  const map = (res?.entities ?? {}) as Record<string, Entity>;
  return ids.map((id) => map[id]).filter((e): e is Entity => !!e && !('missing' in e));
}

/** Facts from the item, with labels (and country codes) of the items it points to. */
export async function readItem(get: JsonGet, entity: Entity, byName: boolean): Promise<Candidate[]> {
  const W = 'WIKIDATA' as const;
  const url = ITEM_URL(entity.id);
  const out: Candidate[] = [];
  const claims = entity.claims ?? {};
  const refs = new Set<string>();
  for (const p of ['P452', 'P159', 'P17', 'P112', 'P169', 'P749', 'P127', 'P414', 'P31']) for (const c of best(claims[p])) { const id = itemId(c.mainsnak); if (id) refs.add(id); }
  const linked = new Map((await getEntities(get, [...refs].slice(0, 50), 'labels|claims')).map((e) => [e.id, e]));
  const label = (id: string | null) => (id ? (linked.get(id)?.labels?.en?.value ?? null) : null);
  const iso = (id: string | null): string | null => {
    const e = id ? linked.get(id) : undefined;
    const code = e ? stringValue(best(e.claims?.P297)[0]?.mainsnak) : null;
    return code && /^[A-Z]{2}$/.test(code) ? code : null;
  };

  const site = websites(entity)[0];
  if (site) out.push(candidate('website', `https://${site}`, W, url, byName ? 'medium' : 'high'));
  const inception = timeValue(best(claims.P571)[0]?.mainsnak);
  if (inception) out.push(candidate('foundedYear', inception, W, url, 'high'));
  const employees = latestQuantity(claims.P1128);
  if (employees) {
    out.push(candidate('employeeCount', employees, W, url, 'high'));
    out.push(candidate('companySize', sizeBand(employees), W, url, 'high'));
  }
  const industries = best(claims.P452).map((c) => label(itemId(c.mainsnak))).filter((l): l is string => !!l);
  if (industries.length) {
    out.push(candidate('industry', capitalise(industries[0]!), W, url, 'high'));
    if (industries.length > 1) out.push(candidate('specialties', industries.map(capitalise).join(', ').slice(0, 1000), W, url, 'high'));
  }
  const hq = itemId(best(claims.P159)[0]?.mainsnak ?? null);
  const hqLabel = label(hq);
  const countryId = itemId(best(claims.P17)[0]?.mainsnak ?? null) ?? itemId(best(linked.get(hq ?? '')?.claims?.P17)[0]?.mainsnak ?? null);
  const country = iso(countryId);
  const countryLabel = label(countryId);
  if (country) {
    out.push(candidate('country', country, W, url, 'high'));
    const tz = singleTimezone(country);
    if (tz) out.push(candidate('timezone', tz, W, url, 'high'));
  }
  if (hqLabel) {
    out.push(candidate('city', hqLabel.slice(0, 120), W, url, 'high'));
    out.push(candidate('headquarters', [hqLabel, countryLabel].filter(Boolean).join(', ').slice(0, 200), W, url, 'high'));
  }
  const founders = best(claims.P112).map((c) => label(itemId(c.mainsnak))).filter((l): l is string => !!l);
  if (founders.length) out.push(candidate('founders', founders.slice(0, 10), W, url, 'high'));
  // The current chief executive: no end date.
  const ceoClaim = (claims.P169 ?? []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582?.length).sort(byRank)[0];
  const ceo = ceoClaim ? label(itemId(ceoClaim.mainsnak)) : null;
  if (ceo) {
    out.push(candidate('ceo', ceo.slice(0, 160), W, url, 'high'));
    out.push(candidate('leadership', [{ name: ceo, title: 'Chief executive officer' }] satisfies Leader[], W, url, 'high'));
  }
  const parent = label(itemId(best(claims.P749)[0]?.mainsnak ?? null));
  if (parent) out.push(candidate('parentCompanyName', parent.slice(0, 200), W, url, 'high'));
  const owners = best(claims.P127).map((c) => label(itemId(c.mainsnak))).filter((l): l is string => !!l);
  if (owners.length) out.push(candidate('ownership', `Owned by ${owners.slice(0, 5).join(', ')}`.slice(0, 300), W, url, 'high'));
  const official = monolingual(best(claims.P1448)[0]?.mainsnak);
  if (official) out.push(candidate('legalName', official.slice(0, 200), W, url, 'high'));
  if (best(claims.P576).length) out.push(candidate('operatingStatus', 'Dissolved', W, url, 'high'));
  const listed = best(claims.P414);
  const instanceOf = best(claims.P31).map((c) => itemId(c.mainsnak));
  if (listed.length || instanceOf.includes('Q891723')) out.push(candidate('companyType', 'Public company', W, url, 'high'));
  const more: MoreDetail[] = [];
  for (const c of listed) {
    const exchange = label(itemId(c.mainsnak));
    const ticker = stringValue(c.qualifiers?.P249?.[0]);
    if (exchange && ticker) more.push({ label: 'Stock ticker', value: `${exchange}: ${ticker}` });
  }
  if (more.length) out.push(candidate('moreDetails', more.slice(0, 3), W, url, 'high'));
  const description = entity.descriptions?.en?.value;
  if (description && description.length >= 20) out.push(candidate('overview', capitalise(description), W, url, 'medium'));

  const links: SocialLink[] = [];
  const profile = (prop: string, platform: SocialPlatform, make: (v: string) => string, ok: RegExp) => {
    const v = stringValue(best(claims[prop])[0]?.mainsnak);
    if (v && ok.test(v)) links.push({ platform, url: make(v) });
  };
  profile('P4264', 'linkedin', (v) => `https://www.linkedin.com/company/${v}`, /^[\w-]{2,100}$/);
  profile('P2002', 'x', (v) => `https://x.com/${v}`, /^\w{1,15}$/);
  profile('P2013', 'facebook', (v) => `https://www.facebook.com/${v}`, /^[\w.-]{2,100}$/);
  profile('P2003', 'instagram', (v) => `https://www.instagram.com/${v}`, /^[\w.]{1,30}$/);
  profile('P2397', 'youtube', (v) => `https://www.youtube.com/channel/${v}`, /^UC[\w-]{20,24}$/);
  profile('P2037', 'github', (v) => `https://github.com/${v}`, /^[\w-]{1,39}$/);
  profile('P7085', 'tiktok', (v) => `https://www.tiktok.com/@${v}`, /^[\w.]{2,24}$/);
  if (links.length) {
    out.push(candidate('socialLinks', links, W, url, 'high'));
    const li = links.find((l) => l.platform === 'linkedin');
    if (li) out.push(candidate('linkedinUrl', li.url, W, url, 'high'));
  }
  return out;
}

// ───────────── claim helpers ─────────────

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Legal endings that do not tell companies apart: "Private Limited", "Pvt. Ltd.", "Inc.", "GmbH", "Pty Ltd" ... */
const LEGAL_ENDING = /[\s,]+(?:(?:private|pvt|pte|pty|public)\.?\s+)?(?:limited|ltd|llc|l\.l\.c|llp|plc|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|s\.a|sas|sarl|bv|b\.v|nv|n\.v|oy|ab|as|spa|s\.p\.a|srl|kk|k\.k|pte|pty)\.?\s*$/i;

/** The name without its legal ending (applied twice: "Acme Holdings Pty. Ltd." -> "Acme Holdings"). */
export function withoutLegalEnding(name: string): string {
  let s = name.trim();
  for (let i = 0; i < 2; i++) s = s.replace(LEGAL_ENDING, '').trim();
  return s;
}

/** Same company name, ignoring case, punctuation and legal endings. */
export const sameName = (a: string, b: string) => norm(withoutLegalEnding(a)) === norm(withoutLegalEnding(b));
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rankOrder = { preferred: 0, normal: 1, deprecated: 2 } as const;
const byRank = (a: Claim, b: Claim) => rankOrder[a.rank ?? 'normal'] - rankOrder[b.rank ?? 'normal'];

/** Preferred-rank claims if any, else the normal ones; never deprecated ones. */
function best(list: Claim[] | undefined): Claim[] {
  const usable = (list ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
  const preferred = usable.filter((c) => c.rank === 'preferred');
  return preferred.length ? preferred : usable;
}

function itemId(snak: Snak | null | undefined): string | null {
  const v = snak?.datavalue?.value as Json | undefined;
  return v && typeof v.id === 'string' && /^Q\d+$/.test(v.id) ? v.id : null;
}
function stringValue(snak: Snak | null | undefined): string | null {
  const v = snak?.datavalue?.value;
  return typeof v === 'string' ? v.trim() : null;
}
function monolingual(snak: Snak | null | undefined): string | null {
  const v = snak?.datavalue?.value as Json | undefined;
  return v && typeof v.text === 'string' && (!v.language || String(v.language).startsWith('en')) ? v.text.trim() : null;
}
/** The year of a time value precise to a year or better. */
function timeValue(snak: Snak | null | undefined): number | null {
  const v = snak?.datavalue?.value as Json | undefined;
  if (!v || typeof v.time !== 'string' || Number(v.precision) < 9) return null;
  const m = /^\+(\d{4})-/.exec(v.time);
  const year = m ? Number(m[1]) : NaN;
  return year >= 1600 && year <= new Date().getUTCFullYear() ? year : null;
}
/** The most recent head count (by its point-in-time qualifier), preferring preferred rank. */
function latestQuantity(list: Claim[] | undefined): number | null {
  const claims = best(list);
  const dated = claims
    .map((c) => {
      const amount = Number(String((c.mainsnak?.datavalue?.value as Json | undefined)?.amount ?? '').replace('+', ''));
      const t = (c.qualifiers?.P585?.[0]?.datavalue?.value as Json | undefined)?.time;
      return { amount, at: typeof t === 'string' ? t : '' };
    })
    .filter((x) => Number.isFinite(x.amount) && x.amount > 0)
    .sort((a, b) => b.at.localeCompare(a.at));
  return dated[0] ? Math.round(dated[0].amount) : null;
}
/** Official website hosts of an item, without www. */
function websites(e: Entity): string[] {
  return best(e.claims?.P856)
    .map((c) => stringValue(c.mainsnak))
    .flatMap((u) => {
      try {
        return u ? [new URL(u).hostname.toLowerCase().replace(/^www\./, '')] : [];
      } catch {
        return [];
      }
    });
}
const isHuman = (e: Entity) => best(e.claims?.P31).some((c) => itemId(c.mainsnak) === 'Q5');
