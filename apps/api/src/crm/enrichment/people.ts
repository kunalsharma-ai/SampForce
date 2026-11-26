import type { FoundPerson } from '@dealflow/types';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Element } from 'domhandler';
import type { Candidate } from './candidates';
import { clean } from './candidates';
import type { Page } from './website';

/*
 * People a company publishes about itself (ADR 0079): the team, leadership or "meet the team" section of its own site,
 * schema.org Person data it published, and the founders, CEO and leaders auto-fill already found (its site, Wikidata).
 * Only what the page shows is taken: a name, and the job title, email and LinkedIn profile written next to it. Nothing
 * is guessed; a person without a name in the same card is not a person. Pure: pages in, people out.
 */

/** Words that name a role: a job title has one ("Head of Research", "Chief Executive Officer"). */
const ROLE_WORDS =
  /\b(ceo|cto|cfo|coo|cmo|cio|cpo|chro|vp|svp|evp|avp|md|founder|co-?founder|chair(man|woman|person)?|president|director|manager|head|lead|leader|officer|executive|partner|principal|owner|chief|vice|associate|assistant|analyst|consultant|engineer|developer|designer|architect|specialist|coordinator|supervisor|advisor|adviser|researcher|scientist|accountant|recruiter|administrator|representative|strategist|intern|trainee|secretary|treasurer|board member|trustee|controller|editor)\b/i;
/** Words a job title may have besides its role; a line with these and no role is a heading or a service, not a title. */
const TITLE_WORDS = new RegExp(`${ROLE_WORDS.source}|\\b(managing|senior|junior|sr|jr|team|account|sales|marketing|operations|finance|hr|human resources|research|project|product|business development|customer success|fieldwork|panel|data|quality|it|board|member)\\b`, 'i');

/** Lines that look like two to four capitalised words but are not a person. */
const NOT_A_NAME =
  /\b(our|team|meet|about|contact|services?|solutions?|company|limited|ltd|llc|inc|pvt|private|group|office|street|road|floor|tower|india|usa|united|kingdom|read|more|view|profile|learn|follow|email|phone|linkedin|twitter|facebook|instagram|youtube|home|careers?|news|blog|privacy|policy|terms|copyright|rights|reserved|market|research|surveys?|insights?|analytics|consulting|panels?|online|global|solutions|healthcare|technology|technologies|systems|studio|labs?|data|services|digital|marketing|development|finance|accounts|management|leadership|people|board|directors|advisors|why|how|what|who|we|us|the|and|of|for|in|at|to)\b/i;

const NAME = /^(?:(?:dr|mr|mrs|ms|miss|prof|er|ca|cs|adv)\.?\s+)?\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3}$/u;

/** Elements that can hold one person's card. */
const CARD_TAGS = new Set(['div', 'li', 'article', 'section', 'figure', 'td', 'tr', 'dl', 'aside', 'a']);
/** Inline elements whose text runs on in the same line. */
const INLINE = new Set(['a', 'b', 'strong', 'i', 'em', 'small', 'u', 'sup', 'sub', 'mark', 'abbr', 'time']);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'option', 'button', 'form', 'canvas', 'head', 'nav', 'header', 'footer']);

/** Pages most likely to list people: the team or leadership page first. */
export const PEOPLE_PATH = /\/(team|our-team|the-team|meet-the-team|meet-our-team|people|our-people|leadership|leadership-team|management|management-team|board|board-of-directors|founders|who-we-are|about[\w-]*|company)\/?$/i;
export const PEOPLE_LINK_TEXT = /^(our |the |meet (the |our )?)?(team|people|leadership( team)?|management( team)?|board( of directors)?|founders|who we are|experts)$/i;

export function looksLikeName(line: string): boolean {
  const s = line.trim();
  if (s.length < 4 || s.length > 48 || /\d|@|[|:/]/.test(s)) return false;
  if (!NAME.test(s)) return false;
  return !TITLE_WORDS.test(s) && !NOT_A_NAME.test(s);
}

export function looksLikeTitle(line: string): boolean {
  const s = line.trim();
  return s.length >= 2 && s.length <= 100 && !/@|https?:/.test(s) && ROLE_WORDS.test(s) && s.split(/\s+/).length <= 12;
}

/** The text lines of an element, one per block, with inline elements kept inside their line. */
function linesOf(el: AnyNode): string[] {
  const out: string[] = [];
  let line = '';
  const flush = () => {
    const t = clean(line);
    if (t) out.push(t);
    line = '';
  };
  const visit = (n: AnyNode) => {
    if (n.type === 'text') {
      line += (n as unknown as { data: string }).data;
      return;
    }
    if (n.type !== 'tag') return;
    const e = n as Element;
    const tag = e.name.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === 'br') return flush();
    if (INLINE.has(tag)) {
      for (const c of e.children) visit(c);
      return;
    }
    flush();
    for (const c of e.children) visit(c);
    flush();
  };
  visit(el);
  flush();
  return out;
}

interface Card {
  el: Element;
  person: FoundPerson;
}

/** People shown as cards on the pages (name with a title, an email or a LinkedIn profile beside it). */
export function peopleOnPages(pages: Page[], domain: string): FoundPerson[] {
  const found: FoundPerson[] = [];
  for (const p of pages) {
    const doc = parseDocument(p.html);
    found.push(...personNodes(doc, p.url));
    const cards: Card[] = [];
    for (const el of DomUtils.findAll((e) => CARD_TAGS.has(e.name.toLowerCase()), doc.children)) {
      const text = clean(DomUtils.textContent(el));
      if (!text || text.length > 600) continue;
      const lines = linesOf(el);
      const names = [...new Set(lines.filter(looksLikeName))];
      if (names.length !== 1) continue;
      const name = names[0]!;
      const links = DomUtils.getElementsByTagName('a', el);
      const linkedin = links.map((a) => a.attribs.href ?? '').find((h) => /linkedin\.com\/in\//i.test(h));
      const mails = links.map((a) => a.attribs.href ?? '').filter((h) => /^mailto:/i.test(h)).map((h) => decodeURIComponent(h.slice(7).split('?')[0]!).trim().toLowerCase());
      const textMails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)?.map((m) => m.toLowerCase()) ?? [];
      const email = [...mails, ...textMails].find((m) => personalEmail(m, domain)) ?? null;
      const after = lines.slice(lines.indexOf(name) + 1);
      const before = lines.slice(0, lines.indexOf(name));
      const title = after.find(looksLikeTitle) ?? before.reverse().find(looksLikeTitle) ?? null;
      // A name alone is not enough: the card must say who they are or how to reach them.
      if (!title && !linkedin && !email) continue;
      cards.push({
        el,
        person: {
          name: name.replace(/\s+/g, ' '),
          title: title ? title.slice(0, 160) : null,
          email,
          linkedinUrl: linkedin ? tidyLinkedin(new URL(linkedin, p.url).toString()) : null,
          source: 'WEBSITE',
          url: p.url,
        },
      });
    }
    // The innermost card wins: a list of cards is itself not a card (it has several names), but a card's wrapper is.
    const inner = cards.filter((c) => !cards.some((o) => o !== c && o.person.name === c.person.name && inside(o.el, c.el)));
    found.push(...inner.map((c) => c.person));
  }
  return mergePeople(found);
}

/** Whether `el` is inside `outer`. */
function inside(el: Element, outer: Element): boolean {
  for (let n = el.parent; n; n = n.parent) if (n === outer) return true;
  return false;
}

/** schema.org Person data: a page about a person, or the company's employee, founder and member lists. */
function personNodes(doc: ReturnType<typeof parseDocument>, url: string): FoundPerson[] {
  const out: FoundPerson[] = [];
  const add = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const types = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    if (!types.includes('Person') || typeof o.name !== 'string' || !looksLikeName(clean(o.name))) return;
    const same = ([] as unknown[]).concat(o.sameAs ?? []).map(String);
    const li = same.find((s) => /linkedin\.com\/in\//i.test(s));
    out.push({
      name: clean(o.name),
      title: typeof o.jobTitle === 'string' ? clean(o.jobTitle).slice(0, 160) : null,
      email: typeof o.email === 'string' ? o.email.replace(/^mailto:/i, '').toLowerCase() : null,
      linkedinUrl: li ? tidyLinkedin(li) : null,
      source: 'SCHEMA_ORG',
      url,
    });
  };
  const walk = (v: unknown, depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    add(o);
    for (const k of ['@graph', 'employee', 'employees', 'founder', 'founders', 'member', 'members', 'author', 'contactPoint']) if (k in o) walk(o[k], depth + 1);
  };
  for (const s of DomUtils.getElementsByTagName('script', doc)) {
    if (!/ld\+json/i.test(s.attribs.type ?? '')) continue;
    try {
      walk(JSON.parse(DomUtils.textContent(s)));
    } catch {
      // Broken JSON-LD is skipped.
    }
  }
  return out;
}

/** Founders, the CEO and leaders auto-fill already read (from the site's structured data or Wikidata), as people. */
export function peopleFromCandidates(candidates: Candidate[]): FoundPerson[] {
  const out: FoundPerson[] = [];
  const src = (c: Candidate): FoundPerson['source'] => (c.source === 'WIKIDATA' ? 'WIKIDATA' : c.source === 'SCHEMA_ORG' ? 'SCHEMA_ORG' : 'WEBSITE');
  for (const c of candidates) {
    if (c.field === 'ceo' && typeof c.value === 'string') out.push({ name: c.value, title: 'CEO', email: null, linkedinUrl: null, source: src(c), url: c.url });
    if (c.field === 'founders' && Array.isArray(c.value)) for (const n of c.value) if (typeof n === 'string') out.push({ name: n, title: 'Founder', email: null, linkedinUrl: null, source: src(c), url: c.url });
    if (c.field === 'leadership' && Array.isArray(c.value)) {
      for (const l of c.value as { name?: string; title?: string | null }[]) if (l.name) out.push({ name: l.name, title: l.title ?? null, email: null, linkedinUrl: null, source: src(c), url: c.url });
    }
  }
  return out.filter((p) => p.name.trim().length >= 3);
}

/** One entry per person (by name), keeping the most complete details; site cards first. */
export function mergePeople(list: FoundPerson[]): FoundPerson[] {
  const by = new Map<string, FoundPerson>();
  const key = (n: string) => n.toLowerCase().replace(/^(dr|mr|mrs|ms|miss|prof)\.?\s+/, '').replace(/[^\p{L}]+/gu, ' ').trim();
  for (const p of list) {
    const k = key(p.name);
    if (!k) continue;
    const had = by.get(k);
    if (!had) {
      by.set(k, { ...p });
      continue;
    }
    had.title ??= p.title;
    had.email ??= p.email;
    had.linkedinUrl ??= p.linkedinUrl;
  }
  return [...by.values()].slice(0, 100);
}

/** A person's own address: not a role mailbox (info@, sales@ ...) and not an image or file name. */
function personalEmail(addr: string, domain: string): boolean {
  const [local, host] = addr.split('@');
  if (!local || !host || /\.(png|jpe?g|gif|svg|webp)$/i.test(host)) return false;
  if (/^(info|contact|contactus|hello|hi|enquir|inquir|mail|office|general|team|admin|sales|support|help|hr|careers?|jobs|press|media|marketing|billing|accounts?|privacy|noreply|no-reply|webmaster)/i.test(local)) return false;
  // The company's own domain, or a sub-domain of it; a team page listing a Gmail address is the person's own choice.
  return host === domain || host.endsWith(`.${domain}`) || /^(gmail|outlook|hotmail|yahoo|icloud|proton(mail)?)\./i.test(host);
}

function tidyLinkedin(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = 'https:';
    u.hostname = 'www.linkedin.com';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}
