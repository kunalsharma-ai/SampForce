import { GEO_COUNTRIES } from './company-crm';

/*
 * Column matching for imports (ADR 0066). Spreadsheet headings come in every spelling: "EMPLOYEE EMAIL ID",
 * "E-mail", "WESBSITE", "Desgnation". These helpers match a heading to a field by its name, its label and a list of
 * common synonyms, ignoring case, punctuation and spacing, and forgiving small typos. The wizard and the API use the
 * same code, so a file mapped automatically in the browser maps the same way through the API.
 */

/** A field a column can go into: its key, its label and the other names people give it. */
export interface ImportTarget {
  value: string;
  label?: string;
  aliases?: readonly string[];
}

/** Synonyms for the built-in import fields. Keys are field names; `company.` and `contact.` keys serve the combined import. */
export const IMPORT_FIELD_ALIASES: Record<string, readonly string[]> = {
  fullName: ['name', 'full name', 'lead name', 'person', 'person name', 'contact name', 'contact person', 'employee name', 'customer name', 'poc', 'poc name'],
  firstName: ['first name', 'given name', 'forename', 'fname'],
  lastName: ['last name', 'surname', 'family name', 'lname'],
  companyName: ['company', 'company name', 'organisation', 'organization', 'org', 'account', 'account name', 'business name', 'firm', 'client', 'client name'],
  jobTitle: ['title', 'job title', 'designation', 'position', 'role', 'job role', 'employee designation', 'contact designation', 'employee title'],
  industry: ['industry', 'sector', 'vertical', 'business category'],
  email: ['email', 'e mail', 'email id', 'mail', 'mail id', 'email address', 'work email', 'business email', 'employee email', 'employee email id', 'contact email'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'cell', 'contact number', 'telephone', 'tel', 'whatsapp', 'employee phone', 'employee mobile'],
  country: ['country', 'country name', 'nation', 'country code'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region', 'county'],
  timezone: ['time zone', 'timezone', 'tz'],
  website: ['website', 'web site', 'site', 'url', 'web', 'homepage', 'company website', 'website url'],
  domain: ['domain', 'company domain', 'web domain'],
  source: ['source', 'lead source'],
  campaignSource: ['campaign', 'campaign source', 'utm campaign'],
  estimatedValue: ['value', 'estimated value', 'deal value', 'amount', 'budget'],
  currency: ['currency'],
  status: ['status', 'lead status'],
  tags: ['tags', 'labels'],
  name: ['company', 'company name', 'name', 'organisation', 'organization', 'account', 'account name', 'business name'],
  linkedinUrl: ['linkedin', 'linkedin url', 'linkedin id', 'linkedin profile', 'linked in'],
  department: ['department', 'dept', 'team', 'function'],
  address: ['address', 'street', 'street address', 'office address', 'company address'],
  postalCode: ['postal code', 'postcode', 'zip', 'zip code', 'pin', 'pin code', 'pincode'],
  primaryEmail: ['company email', 'general email', 'info email'],
  primaryPhone: ['company phone', 'office phone', 'board line', 'main phone'],
  companySize: ['company size', 'size', 'employees', 'headcount', 'no of employees', 'number of employees', 'employee count'],
  companyType: ['company type', 'type of company'],
  remarks: ['remarks', 'remark', 'comments', 'comment', 'notes', 'note'],
  notes: ['notes', 'note', 'remarks', 'comments'],
};

/** Words that only say which record a column belongs to in a one-row-per-employee sheet. */
const CONTACT_WORDS = ['employee', 'contact', 'person', 'poc', 'staff', 'emp'];
const COMPANY_WORDS = ['company', 'organisation', 'organization', 'org', 'account', 'business', 'firm', 'client'];

/** Lower-case words of a heading, without punctuation ("EMPLOYEE E-MAIL ID" → ["employee", "e", "mail", "id"]). */
export function headingWords(heading: string): string[] {
  return heading
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** The heading as one comparable string: "Employee E-mail ID" → "employeeemailid". */
export const headingKey = (heading: string): string => headingWords(heading).join('');

/** Optimal string alignment distance (Levenshtein plus swapped neighbours), stopping early past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** Typos forgiven for a name of this length: none for short names, where one letter changes the meaning. */
const allowedTypos = (length: number): number => (length <= 4 ? 0 : length <= 9 ? 1 : 2);

/** How well a heading matches one name (1 = same words, below 1 = typos), or 0. */
function nameScore(heading: string, name: string): number {
  const a = headingKey(heading);
  const b = headingKey(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = allowedTypos(Math.min(a.length, b.length));
  if (max === 0) return 0;
  const d = editDistance(a, b, max);
  return d <= max ? 0.9 - 0.05 * d : 0;
}

/** The best score of a heading against a target's key, label and synonyms. */
export function targetScore(heading: string, target: ImportTarget): number {
  // Combined-import targets ("company.name") carry their own names in their synonyms; the rest match by key too.
  const field = /^(company|contact)\./.test(target.value) ? '' : target.value.replace(/^customFields\./, '');
  const names = [field, target.label ?? '', ...(target.aliases ?? [])].filter(Boolean);
  return Math.max(0, ...names.map((n) => nameScore(heading, n)));
}

/**
 * Proposes a field for each heading. Each field takes at most one column; where two headings want the same field,
 * the closer match wins. Headings nothing matches well are left out (the caller decides what to do with them).
 */
export function suggestMapping(headings: readonly string[], targets: readonly ImportTarget[]): Record<string, string> {
  const pairs: { heading: string; target: string; score: number; order: number }[] = [];
  headings.forEach((heading, order) => {
    if (!heading.trim()) return;
    for (const t of targets) {
      const score = targetScore(heading, t);
      if (score > 0) pairs.push({ heading, target: t.value, score, order });
    }
  });
  pairs.sort((x, y) => y.score - x.score || x.order - y.order);
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const p of pairs) {
    if (p.heading in out || used.has(p.target)) continue;
    out[p.heading] = p.target;
    used.add(p.target);
  }
  return out;
}

/** Which record a heading most likely describes in a one-row-per-employee sheet. */
export function headingSide(heading: string): 'company' | 'contact' {
  const words = headingWords(heading);
  if (words.some((w) => CONTACT_WORDS.includes(w))) return 'contact';
  if (words.some((w) => COMPANY_WORDS.includes(w))) return 'company';
  return 'company';
}

/** The combined import's fields with synonyms: "EMPLOYEE NAME" → contact.fullName, "COMPANY NAME" → company.name. */
export function combinedImportTargets(fields: readonly string[]): ImportTarget[] {
  const sides = new Map<string, Set<string>>();
  for (const f of fields) {
    const [side, field] = f.split('.') as [string, string];
    sides.set(field, (sides.get(field) ?? new Set()).add(side));
  }
  return fields.map((value) => {
    const [side, field] = value.split('.') as ['company' | 'contact', string];
    const own = side === 'company' ? COMPANY_WORDS : CONTACT_WORDS;
    // "Name" alone is the person's; the company's name needs a company word ("Company name", "Organisation").
    const base = (IMPORT_FIELD_ALIASES[field] ?? []).filter((a) => !(side === 'company' && field === 'name' && a === 'name'));
    // A bare heading ("Country", "LinkedIn") on a field both records have belongs to the company, which is the lead.
    const bare = (sides.get(field)?.size ?? 1) === 1 || side === 'company';
    const prefixed = own.flatMap((w) => [field, ...base].map((a) => `${w} ${a}`));
    const own_ = side === 'company' && field === 'name' ? [] : [field];
    return { value, aliases: [...(bare ? [...own_, ...base] : []), ...prefixed] };
  });
}

/**
 * The field key for a new custom field made from a heading: lower-case words joined by underscores, starting with a
 * letter, at most 40 characters, and not one of `taken`.
 */
export function customFieldKeyFor(heading: string, taken: ReadonlySet<string>): string {
  let base = headingWords(heading).join('_').slice(0, 36).replace(/_+$/, '');
  if (!base) base = 'field';
  else if (!/^[a-z]/.test(base)) base = `f_${base}`.slice(0, 36);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

/** A readable label from a heading: shouted headings become title case, others keep their spelling. */
export function customFieldLabelFor(heading: string): string {
  const h = heading.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (h !== h.toUpperCase() || !/[A-Z]/.test(h)) return h;
  return h.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', us: 'US', america: 'US', unitedstates: 'US', unitedstatesofamerica: 'US', uk: 'GB', unitedkingdom: 'GB', greatbritain: 'GB', britain: 'GB',
  england: 'GB', scotland: 'GB', wales: 'GB', uae: 'AE', emirates: 'AE', ksa: 'SA', saudi: 'SA', southkorea: 'KR', korea: 'KR', northkorea: 'KP',
  russia: 'RU', vietnam: 'VN', laos: 'LA', iran: 'IR', syria: 'SY', czechia: 'CZ', czechrepublic: 'CZ', holland: 'NL', thenetherlands: 'NL',
  turkey: 'TR', turkiye: 'TR', ivorycoast: 'CI', hongkong: 'HK', macau: 'MO', taiwan: 'TW', bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ', moldova: 'MD',
};
const COUNTRY_BY_NAME = new Map(GEO_COUNTRIES.map((c) => [headingKey(c.name), c.code]));
const COUNTRY_CODES = new Set(GEO_COUNTRIES.map((c) => c.code));

/**
 * A two-letter country code from what people type: "IN", "India", "United States of America (USA)", "U.S.A.", "uk".
 * Returns null when the text names no country.
 */
export function countryCodeFrom(text: string | null | undefined): string | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw) && COUNTRY_CODES.has(raw.toUpperCase())) return raw.toUpperCase();
  const tries = [raw, raw.replace(/\(.*?\)/g, ''), ...[...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!)];
  for (const t of tries) {
    const k = headingKey(t);
    if (!k) continue;
    const code = COUNTRY_BY_NAME.get(k) ?? COUNTRY_ALIASES[k] ?? (k.length === 2 && COUNTRY_CODES.has(k.toUpperCase()) ? k.toUpperCase() : undefined);
    if (code) return code;
  }
  return null;
}
