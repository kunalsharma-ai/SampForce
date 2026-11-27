import {
  countryCodeFrom,
  type EnquiryRecord,
  knownCategory,
  knownStatus,
  knownType,
  websiteContactSchema,
  websiteLeadSchema,
  websiteReviewSchema,
} from '@dealflow/types';

/** The website's record, as the columns of one website_enquiries row (the website's side only). */
export interface EnquiryData {
  record: EnquiryRecord;
  externalId: string;
  type: string;
  category: string;
  /** The website's lead status (new...spam), or null for sign-ups and reviews. */
  leadStatus: string | null;
  websiteStatus: string | null;
  formKey: string | null;
  formName: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  company: string | null;
  designation: string | null;
  service: string | null;
  timeline: string | null;
  message: string | null;
  resource: string | null;
  rating: number | null;
  page: string | null;
  consent: boolean;
  subscribed: boolean | null;
  fields: Record<string, string> | null;
  websiteOwner: string | null;
  websiteNote: string | null;
  submittedAt: Date;
  websiteUpdatedAt: Date;
  backfill: boolean;
  raw: Record<string, unknown>;
  searchText: string;
}

const clip = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Label -> text for the extra and other form fields, so nothing a form asked is lost. */
function fieldList(...maps: (Record<string, unknown> | null | undefined)[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      const text = typeof v === 'string' ? v : Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      const key = k.trim().slice(0, 120);
      if (key && Object.keys(out).length < 60) out[key] = text.slice(0, 2000);
    }
  }
  return Object.keys(out).length ? out : null;
}

function personName(c: { name?: string; firstName?: string; lastName?: string } | null | undefined): string | null {
  return clip(c?.name, 200) ?? clip([c?.firstName, c?.lastName].filter(Boolean).join(' '), 200);
}

function phoneOf(c: { phone?: string; countryCode?: string } | null | undefined): string | null {
  const phone = clip(c?.phone, 40);
  if (!phone) return null;
  const code = clip(c?.countryCode, 8);
  return code && !phone.startsWith('+') ? `${code.startsWith('+') ? code : `+${code}`} ${phone}`.slice(0, 48) : phone;
}

function search(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' • ').toLowerCase().slice(0, 4000);
}

/** Reads one record the website sent; returns null when it is not one SampForce can keep (no id or date). */
export function mapWebsiteRecord(record: EnquiryRecord, payload: unknown): EnquiryData | null {
  if (record === 'lead') {
    const p = websiteLeadSchema.safeParse(payload);
    if (!p.success) return null;
    const l = p.data;
    const name = personName(l.contact);
    const email = clip(l.contact?.email, 254)?.toLowerCase() ?? null;
    const company = clip(l.contact?.company, 200);
    const formName = clip(l.form?.name, 200);
    const service = clip(l.enquiry?.service, 500);
    const message = clip(l.enquiry?.message, 10_000);
    const resource = clip(l.enquiry?.resource, 500) ?? clip(l.enquiry?.title, 500) ?? clip(l.enquiry?.interest, 500);
    const country = clip(l.contact?.country, 120);
    const submittedAt = new Date(l.createdAt);
    return {
      record,
      externalId: l.id,
      type: knownType(l.type),
      category: knownCategory(l.category || (l.type === 'chat' ? 'chat' : l.type?.includes('download') ? 'download' : '')),
      leadStatus: knownStatus(l.status),
      websiteStatus: clip(l.status, 40),
      formKey: clip(l.form?.key, 120),
      formName,
      name,
      email,
      phone: phoneOf(l.contact),
      country,
      company,
      designation: clip(l.contact?.designation, 200),
      service,
      timeline: clip(l.enquiry?.timeline, 200),
      message,
      resource,
      rating: null,
      page: clip(l.page, 1000),
      consent: l.consent === true,
      subscribed: null,
      fields: fieldList(l.extraFields, l.otherFields),
      websiteOwner: clip(l.owner, 200),
      websiteNote: clip(l.adminNote, 4000),
      submittedAt,
      websiteUpdatedAt: l.updatedAt ? new Date(l.updatedAt) : submittedAt,
      backfill: l.backfill === true,
      raw: l as Record<string, unknown>,
      searchText: search([name, email, company, l.contact?.phone, country, service, message, formName, resource, l.contact?.designation]),
    };
  }
  if (record === 'contact') {
    const p = websiteContactSchema.safeParse(payload);
    if (!p.success) return null;
    const c = p.data;
    const email = clip(c.email || c.id, 254)?.toLowerCase() ?? null;
    const name = clip(c.name, 200);
    const submittedAt = new Date(c.subscribedAt && !Number.isNaN(Date.parse(c.subscribedAt)) ? c.subscribedAt : c.createdAt);
    return {
      record,
      externalId: (email ?? c.id).toLowerCase(),
      type: 'newsletter',
      category: 'newsletter',
      leadStatus: null,
      websiteStatus: c.subscribed === false ? 'unsubscribed' : 'subscribed',
      formKey: 'newsletter',
      formName: 'Newsletter',
      name,
      email,
      phone: clip(c.phone, 40),
      country: clip(c.country, 120),
      company: clip(c.company, 200),
      designation: clip(c.designation, 200),
      service: null,
      timeline: null,
      message: null,
      resource: null,
      rating: null,
      page: null,
      consent: c.subscribed !== false,
      subscribed: c.subscribed !== false,
      fields: fieldList({ Forms: c.forms?.join(', '), Sources: c.sources?.join(', ') }),
      websiteOwner: null,
      websiteNote: null,
      submittedAt,
      websiteUpdatedAt: c.updatedAt ? new Date(c.updatedAt) : new Date(c.createdAt),
      backfill: false,
      raw: c as Record<string, unknown>,
      searchText: search([name, email, c.company, c.phone, c.country, 'newsletter']),
    };
  }
  const p = websiteReviewSchema.safeParse(payload);
  if (!p.success) return null;
  const r = p.data;
  const name = personName(r.contact);
  const email = clip(r.contact?.email, 254)?.toLowerCase() ?? null;
  const services = (r.services ?? []).map(String).join(', ');
  const submittedAt = new Date(r.createdAt);
  return {
    record,
    externalId: r.id,
    type: 'review',
    category: 'review',
    leadStatus: null,
    websiteStatus: clip(r.status, 40),
    formKey: 'review',
    formName: 'Review',
    name,
    email,
    phone: phoneOf(r.contact),
    country: clip(r.contact?.country, 120),
    company: clip(r.contact?.company, 200),
    designation: clip(r.contact?.designation, 200),
    service: clip(services, 500),
    timeline: null,
    message: clip(r.review, 10_000),
    resource: null,
    rating: typeof r.rating === 'number' ? Math.max(0, Math.min(5, Math.round(r.rating))) : null,
    page: clip(r.page, 1000),
    consent: false,
    subscribed: null,
    fields: fieldList({ 'Our reply': r.reply }),
    websiteOwner: null,
    websiteNote: null,
    submittedAt,
    websiteUpdatedAt: r.updatedAt ? new Date(r.updatedAt) : submittedAt,
    backfill: false,
    raw: r as Record<string, unknown>,
    searchText: search([name, email, r.contact?.company, services, r.review, 'review']),
  };
}

/** A two-letter country code from what the website sent ("India", "IN"), or null. */
export function countryCodeOf(country: string | null | undefined): string | null {
  return countryCodeFrom(country);
}

/** First and last name from a full name ("Asha Rao" -> Asha / Rao). */
export function splitName(name: string | null | undefined, email: string | null | undefined): { firstName: string; lastName: string | null } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return { firstName: words[0]!.slice(0, 120), lastName: words.length > 1 ? words.slice(1).join(' ').slice(0, 120) : null };
  const local = (email ?? '').split('@')[0] ?? '';
  const guess = local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1));
  return guess.length ? { firstName: guess[0]!.slice(0, 120), lastName: guess.slice(1).join(' ').slice(0, 120) || null } : { firstName: 'Website contact', lastName: null };
}
