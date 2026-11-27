import type { Prisma } from '@dealflow/database';
import type { RfqRow, SampbidxPreviewContact, SampbidxPreviewValue } from '@dealflow/types';

/*
 * A SampForce company as a SampBidx client (ADR 0080). The fields follow SampBidx's Clients screen: company name
 * (required), website, industry; the head office (country, city, address); and each contact with name, email,
 * country and time zone (required) plus job title, phone and the two consent ticks. Only employees the person
 * picked go; internal notes, owners, remarks and other employees never do.
 */

type CompanyModel = Prisma.CompanyGetPayload<object>;
type ContactModel = Prisma.ContactGetPayload<object>;

const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function value(v: string | number | boolean | null | undefined, required: boolean, from: SampbidxPreviewValue['from'] = 'record'): SampbidxPreviewValue {
  const val = v === undefined || v === '' ? null : v;
  return { value: val, required, missing: required && (val === null || (typeof val === 'string' && !val.trim())), from: val === null ? null : from };
}

export function website(c: Pick<CompanyModel, 'website' | 'domain'>): string | null {
  const w = text(c.website) ?? (text(c.domain) ? `https://${text(c.domain)}` : null);
  return w;
}

/** The contact as it will be sent: its own details first, the company's country and time zone when it has none. */
export function previewContact(c: ContactModel, company: Pick<CompanyModel, 'country' | 'timezone'>, remoteId: string | null): SampbidxPreviewContact {
  return {
    id: c.id,
    name: value([c.firstName, c.lastName].filter(Boolean).join(' '), true),
    email: value(text(c.email), true),
    jobTitle: value(text(c.jobTitle), false),
    phone: value(text(c.phone), false),
    country: c.country ? value(c.country, true) : value(company.country, true, 'company'),
    timeZone: c.timezone ? value(c.timezone, true) : value(company.timezone, true, 'company'),
    marketingConsent: c.marketingConsent === 'OPTED_IN',
    remoteId,
  };
}

/** The body of PUT /v1/clients/{externalId}. */
export function clientPayload(input: {
  workspace: string;
  transferId: string;
  company: CompanyModel;
  contacts: SampbidxPreviewContact[];
  mayReceiveQuotes: boolean;
}) {
  const c = input.company;
  return {
    system: 'SampForce',
    workspace: input.workspace,
    transferId: input.transferId,
    externalId: c.id,
    company: {
      name: c.name,
      website: website(c),
      industry: text(c.industry),
      leadNumber: c.leadNumber,
      notes: null,
      logoUrl: null,
    },
    offices:
      c.country || c.city || c.address
        ? [{ label: 'Head office', headOffice: true, country: c.country, city: text(c.city), address: text(c.address) }]
        : [],
    contacts: input.contacts.map((p) => ({
      externalId: p.id,
      id: p.remoteId,
      name: p.name.value,
      email: p.email.value,
      jobTitle: p.jobTitle.value,
      phone: p.phone.value,
      country: p.country.value,
      timeZone: p.timeZone.value,
      mayReceiveQuotes: input.mayReceiveQuotes,
      marketingConsent: p.marketingConsent,
    })),
  };
}

/** Country rows of an RFQ as sent: its own rows, or one row from the single market when it has none. */
export function rfqLinesOut(r: RfqRow) {
  if (r.lines.length) return r.lines.map((l) => ({ country: l.country, targetGroup: l.targetGroup, quota: l.quota, loiMinutes: l.loi, incidenceRatePercent: l.ir, cpi: l.cpi, description: l.description }));
  if (!r.market) return [];
  return [{ country: r.market, targetGroup: r.targetAudience, quota: r.sampleSize, loiMinutes: r.loi, incidenceRatePercent: r.ir, cpi: r.cpi, description: null }];
}

export function missingContactFields(p: SampbidxPreviewContact): ('name' | 'email' | 'country' | 'timeZone')[] {
  return (['name', 'email', 'country', 'timeZone'] as const).filter((k) => p[k].missing);
}
