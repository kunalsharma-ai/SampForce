import type { CompanyAddress, ContactPoint, MoreDetail, SocialLink, SocialPlatform } from '@dealflow/types';
import { resolveZone } from '@dealflow/types';
import { socialPlatformOf, tidySocialUrl } from '@dealflow/types';
import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Document, Element } from 'domhandler';
import { type Candidate, candidate, clean, clip, countryCodeOf, countryFromDomain, countryIn, sizeBand } from './candidates';
import { openingHoursOf } from './opening-hours';

/*
 * Reads company facts from the company's own web pages (ADR 0076). Pure: pages in, candidates out. The fetching (public
 * addresses only, redirects checked, sizes capped) is site-fetch.ts. Rules that keep it honest:
 *  - schema.org data the company published is trusted most (SCHEMA_ORG, high); links and contact details the pages
 *    show are next (WEBSITE, high); facts read from page text by pattern are medium; guesses (a country from the web
 *    address, an industry from keywords) are low.
 *  - Only role addresses (info@, sales@, hr@ ...) on the company's own domain are kept. Personal addresses and phone
 *    numbers of people are never collected.
 *  - Nothing is inferred about people (departments, titles) and nothing is made up: a fact not on the pages stays empty.
 */

export interface Page {
  url: string;
  html: string;
}

type Json = Record<string, unknown>;

const ORG_TYPE = /(Organization|Organisation|Corporation|Business|Company|NGO|Store|Agency|Service|Institution|Consortium|Cooperative|Bank|Firm|Clinic|Hospital|Hotel|Restaurant|School|College|University)$/i;
const BLOCK_TAGS = new Set(['p', 'li', 'address', 'td', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figcaption', 'span', 'div', 'section', 'article', 'footer', 'header']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'option', 'button', 'form', 'canvas', 'head']);
const HEADING = /^h[1-6]$/;

/** Role mailboxes worth keeping, with the label shown next to them. */
const ROLE_EMAILS: [RegExp, string][] = [
  [/^(info|contact|contactus|hello|hi|enquir(y|ies)|inquir(y|ies)|mail|office|general|team|admin)$/, 'General'],
  [/^(sales|bd|bdm|biz|bizdev|business|businessdevelopment|newbusiness|rfq|rfqs|quote|quotes|bids|bid|projects|project|proposals)$/, 'Sales and business development'],
  [/^(hr|careers?|jobs|recruit(ment|ing)?|talent|people|hiring|resumes?|cv)$/, 'HR and careers'],
  [/^(support|help|helpdesk|service|services|customerservice|customercare|care|cs)$/, 'Support'],
  [/^(press|media|pr|news|communications|comms)$/, 'Press and media'],
  [/^(marketing|partners?|partnerships?|alliances?|vendors?|suppliers?|procurement|purchasing)$/, 'Partnerships'],
  [/^(accounts?|finance|billing|invoices?|payments?|ar|ap)$/, 'Accounts and finance'],
  [/^(privacy|dpo|gdpr|legal|compliance|security)$/, 'Privacy and legal'],
  [/^(ops|operations|panel|fieldwork|research|data|surveys?|qa|quality)$/, 'Operations'],
];
const GENERAL_FIRST = /^(info|contact|contactus|hello|enquir|inquir|office|general|mail)/;

const CERT_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\bISO(?:\/IEC)?[\s-]?(\d{4,5})(?:\s?[:-]\s?(\d{4}))?\b/gi, (m) => `ISO ${m[1]}${m[2] ? `:${m[2]}` : ''}`],
  [/\bSOC\s?2(?:\s?Type\s?(II|2|I|1))?\b/gi, (m) => `SOC 2${m[1] ? ` Type ${/^(II|2)$/i.test(m[1]) ? 'II' : 'I'}` : ''}`],
  [/\bHIPAA[\s-]compliant\b/gi, () => 'HIPAA compliant'],
  [/\bPCI[\s-]DSS\b/gi, () => 'PCI DSS'],
  [/\bCMMI(?:\s?(?:Level|ML)\s?(\d))?\b/gi, (m) => `CMMI${m[1] ? ` Level ${m[1]}` : ''}`],
  [/\bCyber Essentials(?: Plus)?\b/gi, (m) => (/plus/i.test(m[0]) ? 'Cyber Essentials Plus' : 'Cyber Essentials')],
  [/\bESOMAR\b/g, () => 'ESOMAR member'],
  [/\bInsights Association\b/g, () => 'Insights Association member'],
  [/\bMRS (?:Company Partner|member|accredited)\b/gi, () => 'MRS Company Partner'],
  [/\bGreat Place to Work(?:\s?(?:Certified|®))?\b/gi, () => 'Great Place to Work certified'],
  [/\bB Corp(?:oration)?\b/g, () => 'Certified B Corporation'],
];

/** A small keyword map for the company's own industry, from how it describes itself. Low confidence by design. */
const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  ['Market research', /\b(market research|marketing research|consumer research|fieldwork|data collection|survey (?:programming|research)|online panels?|panel company|quantitative research|qualitative research|b2b research)\b/i],
  ['Clinical research', /\b(clinical research|clinical trials?|contract research organi[sz]ation)\b/i],
  ['Pharmaceuticals', /\b(pharmaceuticals?|drug development)\b/i],
  ['Biotechnology', /\bbiotech(nology)?\b/i],
  ['Medical devices', /\bmedical devices?\b/i],
  ['Healthcare', /\b(healthcare|hospitals?|health care)\b/i],
  ['Software', /\b(saas|software company|software platform|software products?)\b/i],
  ['IT services', /\b(it services|software development services|it consulting|managed services|digital transformation)\b/i],
  ['Cybersecurity', /\b(cyber ?security|information security)\b/i],
  ['Data and analytics', /\b(data analytics|business intelligence|data science)\b/i],
  ['Financial services', /\b(financial services|wealth management|asset management|fintech)\b/i],
  ['Banking', /\bbank(ing)?\b/i],
  ['Insurance', /\binsurance\b/i],
  ['Management consulting', /\b(management consult(ing|ancy)|strategy consult(ing|ancy))\b/i],
  ['Marketing and advertising', /\b(advertising agency|marketing agency|digital marketing|media agency)\b/i],
  ['Staffing and recruiting', /\b(staffing|recruitment agency|executive search)\b/i],
  ['Education', /\b(university|school|e-?learning|edtech|education provider)\b/i],
  ['Manufacturing', /\bmanufactur(er|ing)\b/i],
  ['Logistics', /\b(logistics|freight|supply chain|shipping)\b/i],
  ['Retail', /\b(retailer|retail stores?)\b/i],
  ['E-commerce', /\b(e-?commerce|online store|online shop)\b/i],
  ['Real estate', /\breal estate\b/i],
  ['Construction', /\bconstruction\b/i],
  ['Hospitality', /\b(hotels?|hospitality)\b/i],
  ['Travel', /\b(travel agency|tour operator)\b/i],
  ['Telecommunications', /\btelecom(munications)?\b/i],
  ['Energy', /\b(renewable energy|oil and gas|solar energy|energy company)\b/i],
  ['Automotive', /\bautomotive\b/i],
  ['Legal services', /\b(law firm|legal services)\b/i],
  ['Non-profit', /\b(non-?profit|charity|ngo)\b/i],
  ['Food and beverages', /\b(food and beverages?|f&b|beverages?)\b/i],
  ['Agriculture', /\bagri(culture|tech)\b/i],
  ['Media and publishing', /\b(publishing|publisher|news media)\b/i],
  ['Gaming', /\b(video games?|game studio|gaming)\b/i],
];

const LINK_KINDS: { kind: 'about' | 'contact' | 'offices'; text: RegExp; path: RegExp }[] = [
  { kind: 'about', text: /^(about( us)?|who we are|our (story|company)|company|about [\w-]+)$/i, path: /\/(about(-us)?|who-we-are|our-story|company|about[\w-]*)\/?$/i },
  { kind: 'contact', text: /^(contact( us)?|get in touch|reach us|talk to us)$/i, path: /\/(contact(-us)?|get-in-touch|reach-us)\/?$/i },
  { kind: 'offices', text: /^(our )?(offices|locations|global presence|where we are)$/i, path: /\/(offices|locations|global-presence|our-offices)\/?$/i },
];
const LIST_LINKS: { field: 'services' | 'products' | 'industriesServed'; path: RegExp }[] = [
  { field: 'services', path: /^\/(services?|solutions?|what-we-do|capabilities|expertise|offerings?)\/[^/]+\/?$/i },
  { field: 'products', path: /^\/(products?|platform|tools)\/[^/]+\/?$/i },
  { field: 'industriesServed', path: /^\/(industries|industry|sectors?|markets|verticals)\/[^/]+\/?$/i },
];
const LIST_HEADINGS: { field: 'services' | 'products' | 'industriesServed'; re: RegExp }[] = [
  { field: 'services', re: /^(our )?(services|solutions|capabilities|expertise|what we do|what we offer|offerings)$/i },
  { field: 'products', re: /^(our )?(products|platforms?)$/i },
  { field: 'industriesServed', re: /^(industries( we serve| served)?|sectors( we serve)?|who we serve|markets we serve)$/i },
];
const GENERIC_LINK_TEXT = /^(read more|learn more|more|view (all|more)|see (all|more)|explore|details|click here|know more|discover|services|solutions|products|industries|home|contact( us)?)$/i;

export interface SiteLinks {
  about: string | null;
  contact: string | null;
  offices: string | null;
}

/** The About, Contact and Offices pages the home page links to, on the same site. */
export function pagesToRead(home: Page, domain: string): SiteLinks {
  const doc = parseDocument(home.html);
  const out: SiteLinks = { about: null, contact: null, offices: null };
  for (const a of anchors(doc, home.url)) {
    if (!sameSite(a.href, domain)) continue;
    const path = new URL(a.href).pathname;
    for (const k of LINK_KINDS) {
      if (!out[k.kind] && (k.text.test(a.text) || k.path.test(path))) out[k.kind] = a.href.split('#')[0]!;
    }
  }
  if (out.about && out.about === out.contact) out.contact = null;
  return out;
}

/** Everything the pages say about the company, as candidates. `pages[0]` is the home page. */
export function readWebsite(pages: Page[], domain: string, contactPageUrl: string | null): Candidate[] {
  const out: Candidate[] = [];
  const parsed = pages.map((p) => ({ ...p, doc: parseDocument(p.html) }));
  const home = parsed[0];
  if (!home) return out;

  // 1. schema.org (JSON-LD) published by the company.
  for (const p of parsed) out.push(...fromJsonLd(jsonLd(p.doc), p.url, domain));

  // 2. Meta tags of the home page and the About page.
  const metaOf = (doc: Document) => {
    const m = new Map<string, string>();
    for (const el of DomUtils.getElementsByTagName('meta', doc)) {
      const key = (el.attribs.property ?? el.attribs.name ?? '').toLowerCase();
      if (key && el.attribs.content && !m.has(key)) m.set(key, clean(el.attribs.content));
    }
    return m;
  };
  const homeMeta = metaOf(home.doc);
  const description = homeMeta.get('og:description') || homeMeta.get('description') || homeMeta.get('twitter:description');
  if (description && usefulDescription(description)) out.push(candidate('overview', clip(description, 1000), 'WEBSITE', home.url, 'high'));
  const handle = homeMeta.get('twitter:site')?.replace(/^@/, '');
  if (handle && /^[A-Za-z0-9_]{1,15}$/.test(handle)) out.push(candidate('socialLinks', [{ platform: 'x', url: `https://x.com/${handle}` }], 'WEBSITE', home.url, 'medium'));

  // 3. Links on every page: profiles, mail and phone links, service and product pages.
  const social = new Map<SocialPlatform, { url: string; page: string; count: number }>();
  const emails = new Map<string, { point: ContactPoint; page: string; confidence: 'high' | 'medium' }>();
  const phones = new Map<string, { point: ContactPoint; page: string }>();
  const lists = { services: new Map<string, string>(), products: new Map<string, string>(), industriesServed: new Map<string, string>() };
  const listPage = { services: home.url, products: home.url, industriesServed: home.url };
  for (const p of parsed) {
    for (const a of anchors(p.doc, p.url)) {
      if (/^mailto:/i.test(a.href)) {
        const addr = decodeURIComponent(a.href.slice(7).split('?')[0]!).trim().toLowerCase();
        const label = roleLabel(addr, domain);
        if (label && !emails.has(addr)) emails.set(addr, { point: { value: addr, label }, page: p.url, confidence: 'high' });
        continue;
      }
      if (/^tel:/i.test(a.href)) {
        const fromLink = tidyPhone(decodeURIComponent(a.href.slice(4)));
        // The link text usually has the readable spacing ("+44 20 7946 0958"); use it when it is the same number.
        const shown = tidyPhone(a.text);
        const num = shown && fromLink && digitsKey(shown) === digitsKey(fromLink) ? shown : fromLink;
        if (num && !phones.has(digitsKey(num))) phones.set(digitsKey(num), { point: { value: num, label: null }, page: p.url });
        continue;
      }
      const platform = socialPlatformOf(a.href);
      if (platform) {
        const url = tidySocialUrl(a.href);
        const seen = social.get(platform);
        if (!seen) social.set(platform, { url, page: p.url, count: 1 });
        else if (seen.url === url) seen.count++;
        continue;
      }
      if (!sameSite(a.href, domain)) continue;
      const path = new URL(a.href).pathname;
      for (const l of LIST_LINKS) {
        if (l.path.test(path) && usefulItem(a.text)) {
          const key = a.text.toLowerCase();
          if (!lists[l.field].has(key)) lists[l.field].set(key, a.text);
          if (lists[l.field].size === 1) listPage[l.field] = p.url;
        }
      }
    }
  }
  if (social.size) {
    out.push(candidate('socialLinks', [...social].map(([platform, s]) => ({ platform, url: s.url })), 'WEBSITE', home.url, 'high'));
    const li = social.get('linkedin');
    if (li) out.push(candidate('linkedinUrl', li.url, 'WEBSITE', li.page, 'high'));
  }

  // 4. Page text: headings with service lists, addresses, emails, phones, founding year, head count, certifications.
  const blocks = parsed.flatMap((p) => textBlocks(p.doc).map((b) => ({ ...b, page: p.url })));
  for (const h of LIST_HEADINGS) {
    for (const p of parsed) {
      for (const items of listsUnderHeading(p.doc, h.re)) {
        for (const item of items) if (!lists[h.field].has(item.toLowerCase())) lists[h.field].set(item.toLowerCase(), item);
        if (items.length) listPage[h.field] = p.url;
      }
    }
  }
  for (const field of ['services', 'products', 'industriesServed'] as const) {
    const items = [...lists[field].values()].slice(0, 20);
    if (items.length) out.push(candidate(field, items, 'WEBSITE', listPage[field], 'medium'));
  }

  for (const b of blocks) {
    for (const m of b.text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) {
      const addr = m[0].toLowerCase().replace(/\.$/, '');
      const label = roleLabel(addr, domain);
      if (label && !emails.has(addr)) emails.set(addr, { point: { value: addr, label }, page: b.page, confidence: 'medium' });
    }
    const labelled = /(?:^|\b)(?:phone|tel(?:ephone)?|call(?: us)?|ph|mob(?:ile)?|t)\s*[.:]\s*(\+?[\d][\d\s().-]{6,22}\d)/gi;
    for (const m of b.text.matchAll(labelled)) {
      const num = tidyPhone(m[1]!);
      if (num && !phones.has(digitsKey(num))) phones.set(digitsKey(num), { point: { value: num, label: null }, page: b.page });
    }
  }
  if (emails.size) {
    const list = [...emails.values()].slice(0, 12);
    const best = list.find((e) => GENERAL_FIRST.test(e.point.value.split('@')[0]!)) ?? list[0]!;
    for (const conf of ['high', 'medium'] as const) {
      const group = list.filter((e) => e.confidence === conf);
      if (group.length) out.push(candidate('emails', group.map((e) => e.point), 'WEBSITE', group[0]!.page, conf));
    }
    out.push(candidate('primaryEmail', best.point.value, 'WEBSITE', best.page, best.confidence));
  }
  if (phones.size) {
    const list = [...phones.values()].slice(0, 8);
    out.push(candidate('phones', list.map((p) => p.point), 'WEBSITE', list[0]!.page, 'high'));
    out.push(candidate('primaryPhone', list[0]!.point.value, 'WEBSITE', list[0]!.page, 'high'));
  }

  const offices = officeAddresses(parsed);
  out.push(...addressCandidates(offices, 'WEBSITE', 'medium'));

  const year = foundedYearIn(blocks);
  if (year) out.push(candidate('foundedYear', year.year, 'WEBSITE', year.page, 'medium'));
  const heads = headCountIn(blocks);
  if (heads) {
    out.push(candidate('employeeCount', heads.count, 'WEBSITE', heads.page, 'medium'));
    out.push(candidate('companySize', sizeBand(heads.count), 'WEBSITE', heads.page, 'medium'));
  }
  const certs = new Map<string, string>();
  let certPage = home.url;
  for (const b of blocks) {
    for (const [re, name] of CERT_PATTERNS) {
      for (const m of b.text.matchAll(new RegExp(re.source, re.flags))) {
        const n = name(m);
        if (!certs.has(n.toLowerCase())) {
          if (!certs.size) certPage = b.page;
          certs.set(n.toLowerCase(), n);
        }
      }
    }
  }
  // "ISO 27001" and "ISO 27001:2013" are the same certificate: keep the dated one.
  const certList = [...certs.values()].filter((c, _i, all) => !(/^ISO \d+$/.test(c) && all.some((o) => o.startsWith(`${c}:`))));
  if (certList.length) out.push(candidate('certifications', certList.slice(0, 20), 'WEBSITE', certPage, 'medium'));

  // About page description, when no meta description was useful.
  const about = parsed.find((p) => /about|who-we-are|our-story|company/i.test(new URL(p.url).pathname));
  if (about) {
    const para = textBlocks(about.doc).find((b) => b.tag === 'p' && b.text.length >= 120 && usefulDescription(b.text));
    if (para) out.push(candidate('overview', clip(para.text, 1000), 'WEBSITE', about.url, 'medium'));
  }

  const title = clean(DomUtils.textContent(DomUtils.getElementsByTagName('title', home.doc)[0] ?? []));
  const selfDescription = [title, homeMeta.get('og:description'), homeMeta.get('description')].filter(Boolean).join(' . ');
  const industry = INDUSTRY_KEYWORDS.find(([, re]) => re.test(selfDescription));
  if (industry) out.push(candidate('industry', industry[0], 'WEBSITE', home.url, 'low'));

  if (contactPageUrl) out.push(candidate('contactPageUrl', contactPageUrl, 'WEBSITE', contactPageUrl, 'high'));
  const tld = countryFromDomain(domain);
  if (tld) out.push(candidate('country', tld, 'WEBSITE', home.url, 'low'));
  return out;
}

// ───────────── schema.org ─────────────

function jsonLd(doc: Document): Json[] {
  const nodes: Json[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Json;
      if (Array.isArray(o['@graph'])) walk(o['@graph']);
      nodes.push(o);
    }
  };
  for (const s of DomUtils.getElementsByTagName('script', doc)) {
    if (!/ld\+json/i.test(s.attribs.type ?? '')) continue;
    const raw = DomUtils.textContent(s).trim();
    if (!raw || raw.length > 500_000) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      // Some sites publish broken JSON-LD; skip it.
    }
  }
  return nodes;
}

const types = (o: Json): string[] => (Array.isArray(o['@type']) ? (o['@type'] as unknown[]).map(String) : o['@type'] ? [String(o['@type'])] : []);
const str = (v: unknown): string | null => (typeof v === 'string' && clean(v) ? clean(v) : typeof v === 'number' ? String(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const nameOf = (v: unknown): string | null => (typeof v === 'string' ? str(v) : v && typeof v === 'object' ? str((v as Json).name) : null);

function fromJsonLd(nodes: Json[], url: string, domain: string): Candidate[] {
  const orgs = nodes.filter((n) => types(n).some((t) => ORG_TYPE.test(t)) && !types(n).some((t) => /^(WebSite|WebPage|Person)$/i.test(t)));
  // The company itself: the organisation on its own domain, or the first one.
  const org = orgs.find((o) => typeof o.url === 'string' && sameSite(o.url, domain)) ?? orgs[0];
  if (!org) return [];
  const out: Candidate[] = [];
  const S = 'SCHEMA_ORG' as const;
  const desc = str(org.description);
  if (desc && usefulDescription(desc)) out.push(candidate('overview', clip(desc, 1000), S, url, 'high'));
  const legal = str(org.legalName);
  if (legal) out.push(candidate('legalName', legal.slice(0, 200), S, url, 'high'));
  const founded = str(org.foundingDate)?.match(/\b(1[6-9]\d\d|20\d\d)\b/);
  if (founded && Number(founded[1]) <= new Date().getUTCFullYear()) out.push(candidate('foundedYear', Number(founded[1]), S, url, 'high'));
  const founders = arr(org.founder).map(nameOf).filter((n): n is string => !!n);
  if (founders.length) out.push(candidate('founders', founders.slice(0, 10), S, url, 'high'));
  const employees = org.numberOfEmployees as Json | number | string | undefined;
  const count = typeof employees === 'object' && employees ? Number(employees.value ?? employees.maxValue ?? employees.minValue) : Number(employees);
  if (Number.isFinite(count) && count > 0) {
    out.push(candidate('employeeCount', Math.round(count), S, url, 'high'));
    out.push(candidate('companySize', sizeBand(count), S, url, 'high'));
  }
  const parent = nameOf(org.parentOrganization);
  if (parent) out.push(candidate('parentCompanyName', parent.slice(0, 200), S, url, 'high'));

  const emails: ContactPoint[] = [];
  const phones: ContactPoint[] = [];
  const addEmail = (v: unknown, label: string | null) => {
    const e = str(v)?.replace(/^mailto:/i, '').toLowerCase();
    if (e && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && (roleLabel(e, domain) || sameSite(`https://${e.split('@')[1]}`, domain))) emails.push({ value: e, label: label ?? roleLabel(e, domain) ?? 'General' });
  };
  const addPhone = (v: unknown, label: string | null) => {
    const p = tidyPhone(str(v) ?? '');
    if (p) phones.push({ value: p, label });
  };
  addEmail(org.email, null);
  addPhone(org.telephone, null);
  for (const cp of arr(org.contactPoint)) {
    if (!cp || typeof cp !== 'object') continue;
    const c = cp as Json;
    const label = str(c.contactType) ? titleCase(str(c.contactType)!).slice(0, 60) : null;
    addEmail(c.email, label);
    addPhone(c.telephone, label);
  }
  if (emails.length) {
    out.push(candidate('emails', emails, S, url, 'high'));
    out.push(candidate('primaryEmail', emails[0]!.value, S, url, 'high'));
  }
  if (phones.length) {
    out.push(candidate('phones', phones, S, url, 'high'));
    out.push(candidate('primaryPhone', phones[0]!.value, S, url, 'high'));
  }

  const offices: Office[] = [];
  const addAddress = (v: unknown, label: string | null) => {
    if (!v || typeof v !== 'object') return;
    const a = v as Json;
    const country = countryCodeOf(a.addressCountry);
    const office: Office = { label, country, state: str(a.addressRegion), city: str(a.addressLocality), address: str(a.streetAddress), postalCode: str(a.postalCode), page: url, hq: !label };
    if (office.address || office.city) offices.push(office);
  };
  for (const a of arr(org.address)) addAddress(a, null);
  for (const loc of arr(org.location)) if (loc && typeof loc === 'object') addAddress((loc as Json).address, nameOf(loc) ?? 'Office');
  out.push(...addressCandidates(offices, S, 'high'));

  const links: SocialLink[] = [];
  for (const s of arr(org.sameAs)) {
    const u = str(s);
    const platform = u ? socialPlatformOf(u) : null;
    if (u && platform && !links.some((l) => l.platform === platform)) links.push({ platform, url: tidySocialUrl(u) });
  }
  if (links.length) {
    out.push(candidate('socialLinks', links, S, url, 'high'));
    const li = links.find((l) => l.platform === 'linkedin');
    if (li) out.push(candidate('linkedinUrl', li.url, S, url, 'high'));
  }
  const more: MoreDetail[] = [];
  const detail = (label: string, v: unknown) => {
    const s = arr(v).map(nameOf).filter(Boolean).join(', ');
    if (s) more.push({ label, value: s.slice(0, 1000) });
  };
  detail('Slogan', org.slogan);
  detail('Awards', org.award ?? org.awards);
  detail('VAT number', org.vatID);
  detail('Tax ID', org.taxID);
  detail('DUNS number', org.duns);
  detail('LEI code', org.leiCode);
  detail('Areas served', org.areaServed);
  if (more.length) out.push(candidate('moreDetails', more, S, url, 'high'));
  const hours = openingHoursOf(org);
  if (hours) out.push(candidate('workingHours', hours, S, url, 'high'));
  const knows = arr(org.knowsAbout).map(nameOf).filter((n): n is string => !!n && n.length <= 80);
  if (knows.length) out.push(candidate('specialties', knows.slice(0, 15).join(', '), S, url, 'high'));
  return out;
}

// ───────────── addresses ─────────────

interface Office {
  label: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  page: string;
  /** Labelled as the head office. */
  hq: boolean;
}

const HQ_LABEL = /\b(head ?(office|quarters)|headquarters|hq|corporate (office|headquarters)|registered office|global headquarters|main office)\b/i;
const POSTAL = /\b(\d{3}\s?\d{3}|\d{5}(?:-\d{4})?|\d{4}|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|\d{3}-\d{4}|\d{2}-\d{3})\b/;

/** Office addresses written on the pages: <address> elements and text blocks that read like an address. */
function officeAddresses(pages: (Page & { doc: Document })[]): Office[] {
  const out: Office[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const b of textBlocks(p.doc)) {
      const text = b.text;
      if (text.length < 15 || text.length > 320) continue;
      const looksLikeAddress = b.tag === 'address' || (/\d/.test(text) && (text.match(/,/g) ?? []).length >= 2);
      if (!looksLikeAddress) continue;
      const country = countryIn(text);
      if (!country) continue;
      // Not a sentence: addresses have few words per comma and no verbs like "we", "our".
      if (/\b(we|our|you|your|is|are|have|has|offer|provide)\b/i.test(text) && b.tag !== 'address') continue;
      const office = parseAddress(text, country, b.heading, p.url);
      if (!office) continue;
      const key = `${office.address}|${office.city}|${office.country}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(office);
      if (out.length >= 25) return out;
    }
  }
  return out;
}

function parseAddress(raw: string, country: { code: string; match: string }, heading: string | null, page: string): Office | null {
  let text = raw.replace(/^(address|head office|headquarters|hq|registered office|corporate office|office)\s*[:\-–]\s*/i, '');
  let label: string | null = null;
  const labelMatch = /^([A-Z][\w &'-]{1,40}(?:office|headquarters|hq|centre|center|branch))\s*[:\-–]?\s+/i.exec(text);
  if (labelMatch && labelMatch[1]!.split(' ').length <= 5) {
    label = labelMatch[1]!.trim();
    text = text.slice(labelMatch[0].length);
  } else if (heading && heading.length <= 50 && !/contact|address|reach|touch|follow/i.test(heading)) {
    label = heading;
  }
  // Drop phone and email bits that often follow the address in the same block.
  text = text.replace(/(?:phone|tel|t|e|email|mail|fax)\s*[.:].*$/i, '').replace(/[A-Za-z0-9._%+-]+@\S+/g, '').replace(/\+\d[\d\s().-]{6,}/g, '').trim();
  const countryAt = text.toLowerCase().lastIndexOf(country.match.toLowerCase());
  const before = (countryAt >= 0 ? text.slice(0, countryAt) : text).replace(/[,\s-–]+$/, '');
  const parts = before.split(/\s*[,\n]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let postalCode: string | null = null;
  let city: string | null = null;
  let state: string | null = null;
  // Walk back from the end: "City 411001", "City - 411001", "State 411001", "411001".
  for (let i = parts.length - 1; i >= 0 && !postalCode; i--) {
    const m = POSTAL.exec(parts[i]!);
    if (!m) continue;
    postalCode = m[1]!;
    const rest = parts[i]!.replace(m[0], '').replace(/[-–\s]+$/, '').replace(/^[-–\s]+/, '').trim();
    if (rest && /^\p{L}[\p{L} .'-]{1,40}$/u.test(rest)) {
      city = rest;
      parts.splice(i, 1);
      if (i - 1 >= 0 && i === parts.length && /^\p{L}[\p{L} .'-]{1,40}$/u.test(parts[i - 1]!) && parts.length > 2) {
        state = city;
        city = parts.splice(i - 1, 1)[0]!;
      }
    } else {
      parts.splice(i, 1);
      const prev = parts[i - 1];
      if (prev && /^\p{L}[\p{L} .'-]{1,40}$/u.test(prev)) city = parts.splice(i - 1, 1)[0]!;
    }
  }
  if (!city && parts.length >= 2) {
    const last = parts.at(-1)!;
    if (/^\p{L}[\p{L} .'-]{1,40}$/u.test(last)) city = parts.pop()!;
  }
  const address = parts.join(', ');
  if (!address && !city) return null;
  return { label: label ? label.slice(0, 60) : null, country: country.code, state, city, address: address ? address.slice(0, 500) : null, postalCode, page, hq: HQ_LABEL.test(`${label ?? ''} ${raw.slice(0, 40)}`) };
}

/** The head office (labelled, else the first listed) as the company's address; the others as further offices. */
function addressCandidates(offices: Office[], source: 'SCHEMA_ORG' | 'WEBSITE', confidence: 'high' | 'medium'): Candidate[] {
  if (!offices.length) return [];
  const hq = offices.find((o) => o.hq) ?? offices[0]!;
  const hqConfidence = hq.hq || offices.length === 1 ? confidence : 'medium';
  const out: Candidate[] = [];
  if (hq.address) out.push(candidate('address', hq.address, source, hq.page, hqConfidence));
  if (hq.city) out.push(candidate('city', hq.city.slice(0, 120), source, hq.page, hqConfidence));
  if (hq.state) out.push(candidate('state', hq.state.slice(0, 120), source, hq.page, hqConfidence));
  if (hq.postalCode) out.push(candidate('postalCode', hq.postalCode.slice(0, 20), source, hq.page, hqConfidence));
  if (hq.country) {
    out.push(candidate('country', hq.country, source, hq.page, hqConfidence));
    // The zone from the country, state or city (ADR 0088); a country with several zones and no state gives none.
    const tz = resolveZone({ country: hq.country, state: hq.state, city: hq.city });
    if (tz.zone && tz.exact) out.push(candidate('timezone', tz.zone, source, hq.page, hqConfidence));
  }
  const place = [hq.city, hq.country ? countryName(hq.country) : null].filter(Boolean).join(', ');
  if (place) out.push(candidate('headquarters', place.slice(0, 200), source, hq.page, hqConfidence));
  const others: CompanyAddress[] = offices
    .filter((o) => o !== hq)
    .map((o) => ({ label: o.label, country: o.country, state: o.state, city: o.city, address: o.address, postalCode: o.postalCode }));
  if (others.length) out.push(candidate('addresses', others, source, offices.find((o) => o !== hq)!.page, confidence));
  if (offices.length >= 2) out.push(candidate('branchCount', offices.length, source, hq.page, 'medium'));
  return out;
}

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => COUNTRY_NAMES.of(code) ?? code;

// ───────────── text helpers ─────────────

interface Block {
  tag: string;
  text: string;
  heading: string | null;
}

/** Text of block elements that hold text directly, each with the nearest heading before it. */
function textBlocks(doc: Document): Block[] {
  const out: Block[] = [];
  let heading: string | null = null;
  const visit = (node: AnyNode) => {
    if (node.type !== 'tag') return;
    const el = node as Element;
    const tag = el.name.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (HEADING.test(tag)) {
      const t = clean(textWithBreaks(el));
      if (t) {
        heading = t.slice(0, 120);
        out.push({ tag, text: t, heading: null });
      }
      return;
    }
    const childBlocks = el.children.some((c) => c.type === 'tag' && (BLOCK_TAGS.has((c as Element).name.toLowerCase()) && (c as Element).name.toLowerCase() !== 'span'));
    if (BLOCK_TAGS.has(tag) && !childBlocks) {
      const t = clean(textWithBreaks(el).replace(/\n+/g, ', ').replace(/,\s*,/g, ',')).replace(/^[,\s]+|[,\s]+$/g, '');
      if (t && t.length <= 2000) out.push({ tag, text: t, heading });
      return;
    }
    for (const c of el.children) visit(c);
  };
  for (const c of doc.children) visit(c);
  return out;
}

/** Text with <br> and nested blocks turned into line breaks, so address lines stay apart. */
function textWithBreaks(node: AnyNode): string {
  if (node.type === 'text') return (node as unknown as { data: string }).data;
  if (node.type !== 'tag') return '';
  const el = node as Element;
  const tag = el.name.toLowerCase();
  if (SKIP_TAGS.has(tag)) return '';
  if (tag === 'br') return '\n';
  const inner = el.children.map(textWithBreaks).join('');
  return BLOCK_TAGS.has(tag) && tag !== 'span' ? `\n${inner}\n` : inner;
}

function anchors(doc: Document, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const a of DomUtils.getElementsByTagName('a', doc)) {
    const raw = a.attribs.href?.trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) continue;
    try {
      const href = /^(mailto|tel):/i.test(raw) ? raw : new URL(raw, base).toString();
      out.push({ href, text: clean(DomUtils.textContent(a) || a.attribs.title || a.attribs['aria-label'] || '') });
    } catch {
      // Not a usable link.
    }
  }
  return out;
}

/** Items of a list (li, h3/h4 cards) that follows a heading such as "Our services". */
function listsUnderHeading(doc: Document, re: RegExp): string[][] {
  const out: string[][] = [];
  for (const h of DomUtils.findAll((el) => HEADING.test(el.name.toLowerCase()) && re.test(clean(DomUtils.textContent(el)).replace(/[:.]$/, '')), doc.children)) {
    const level = Number(h.name[1]);
    const items: string[] = [];
    // Walk the following siblings of the heading (and of its wrapper) until the next heading of the same level.
    let node: AnyNode | null = h.nextSibling ?? (h.parent as Element | null)?.nextSibling ?? null;
    let steps = 0;
    while (node && steps++ < 30 && items.length < 20) {
      if (node.type === 'tag') {
        const el = node as Element;
        if (HEADING.test(el.name) && Number(el.name[1]) <= level) break;
        const sub = DomUtils.findAll((e) => e.name === 'li' || (HEADING.test(e.name) && Number(e.name[1]) > level), [el]);
        const cands = HEADING.test(el.name) && Number(el.name[1]) > level ? [el] : sub;
        for (const c of cands) {
          const firstHeading = DomUtils.findOne((e) => HEADING.test(e.name), [c], true);
          const t = clean(DomUtils.textContent(c.name === 'li' && firstHeading ? firstHeading : c));
          if (usefulItem(t) && !items.some((i) => i.toLowerCase() === t.toLowerCase())) items.push(t);
        }
        if (DomUtils.findOne((e) => HEADING.test(e.name) && Number(e.name[1]) <= level, [el], true)) break;
      }
      node = node.nextSibling;
    }
    if (items.length >= 2) out.push(items);
  }
  return out;
}

function sameSite(href: string, domain: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** A role mailbox on the company's own domain gets a label; anything else (a person, another domain) is skipped. */
function roleLabel(addr: string, domain: string): string | null {
  const [local, host] = addr.split('@');
  if (!local || !host) return null;
  if (!sameSite(`https://${host}`, domain)) return null;
  const key = local.toLowerCase().replace(/[._-]/g, '');
  for (const [re, label] of ROLE_EMAILS) if (re.test(key)) return label;
  return null;
}

function tidyPhone(raw: string): string | null {
  const s = raw.replace(/[^\d+().\s-]/g, '').replace(/\s+/g, ' ').trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (!/^\+?[0-9 ().-]{6,}$/.test(s)) return null;
  return s.slice(0, 40);
}
const digitsKey = (p: string) => p.replace(/\D/g, '').slice(-10);

function usefulDescription(s: string): boolean {
  return s.length >= 40 && !/^(just another wordpress site|home|welcome|coming soon|untitled)/i.test(s) && !/lorem ipsum/i.test(s);
}

function usefulItem(s: string): boolean {
  return s.length >= 3 && s.length <= 80 && !GENERIC_LINK_TEXT.test(s) && !/^\d+$/.test(s) && s.split(' ').length <= 8;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function foundedYearIn(blocks: (Block & { page: string })[]): { year: number; page: string } | null {
  const now = new Date().getUTCFullYear();
  const patterns = [
    /\b(?:founded|established|incorporated|set up|started|began operations|in business)\b(?:\s+(?:in|back in|way back in))?\s+(?:the year\s+)?(1[6-9]\d\d|20\d\d)\b/i,
    /\b(?:since|est\.?|estd\.?)\s+(1[6-9]\d\d|20\d\d)\b/i,
  ];
  for (const re of patterns) {
    for (const b of blocks) {
      const m = re.exec(b.text);
      if (m && Number(m[1]) <= now && !/©|copyright/i.test(b.text.slice(Math.max(0, m.index - 20), m.index))) return { year: Number(m[1]), page: b.page };
    }
  }
  return null;
}

function headCountIn(blocks: (Block & { page: string })[]): { count: number; page: string } | null {
  const re = /\b(\d{1,3}(?:[,.]\d{3})*|\d+)\s*\+?\s*(?:full[- ]time\s+)?(?:employees|staff members|staff|team members|professionals|people work)\b/i;
  for (const b of blocks) {
    const m = re.exec(b.text);
    if (!m) continue;
    const n = Number(m[1]!.replace(/[,.]/g, ''));
    if (n >= 2 && n <= 5_000_000) return { count: n, page: b.page };
  }
  return null;
}
