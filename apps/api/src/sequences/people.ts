import type { TenantTx } from '@dealflow/database';
import type { MarketingConsent, MergeValues } from '@dealflow/types';

/** A lead or contact as a sequence sees it. */
export interface Person {
  type: 'lead' | 'contact';
  id: string;
  name: string;
  email: string | null;
  consent: MarketingConsent;
  ownerId: string | null;
  values: MergeValues;
}

const firstOf = (full: string) => full.trim().split(/\s+/)[0] ?? '';

export async function loadLeads(tx: TenantTx, tenantId: string, ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const rows = await tx.lead.findMany({
    where: { tenantId, id: { in: ids }, deletedAt: null },
    select: { id: true, fullName: true, email: true, companyName: true, jobTitle: true, country: true, marketingConsent: true, ownerId: true },
  });
  return rows.map((l) => {
    const [first = '', ...rest] = l.fullName.trim().split(/\s+/);
    return {
      type: 'lead' as const,
      id: l.id,
      name: l.fullName,
      email: l.email?.trim().toLowerCase() || null,
      consent: l.marketingConsent,
      ownerId: l.ownerId,
      values: { first_name: first, last_name: rest.join(' '), full_name: l.fullName, email: l.email, company: l.companyName, job_title: l.jobTitle, country: l.country },
    };
  });
}

export async function loadContacts(tx: TenantTx, tenantId: string, ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const rows = await tx.contact.findMany({
    where: { tenantId, id: { in: ids }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, country: true, marketingConsent: true, ownerId: true, company: { select: { name: true } } },
  });
  return rows.map((c) => {
    const full = [c.firstName, c.lastName].filter(Boolean).join(' ');
    return {
      type: 'contact' as const,
      id: c.id,
      name: full,
      email: c.email?.trim().toLowerCase() || null,
      consent: c.marketingConsent,
      ownerId: c.ownerId,
      values: { first_name: c.firstName, last_name: c.lastName, full_name: full, email: c.email, company: c.company?.name, job_title: c.jobTitle, country: c.country },
    };
  });
}

export async function loadPerson(tx: TenantTx, tenantId: string, ref: { leadId?: string | null; contactId?: string | null }): Promise<Person | null> {
  if (ref.contactId) return (await loadContacts(tx, tenantId, [ref.contactId]))[0] ?? null;
  if (ref.leadId) return (await loadLeads(tx, tenantId, [ref.leadId]))[0] ?? null;
  return null;
}

export function senderValues(user: { name: string; email: string } | null, mailbox?: string | null): MergeValues {
  if (!user) return {};
  return { sender_name: user.name, sender_first_name: firstOf(user.name), sender_email: mailbox ?? user.email };
}

/** The record an email event is about: the contact if there is one, else the lead. */
export function personSubject(p: { leadId: string | null; contactId: string | null }): { entityType: 'lead' | 'contact'; entityId: string } | null {
  if (p.contactId) return { entityType: 'contact', entityId: p.contactId };
  if (p.leadId) return { entityType: 'lead', entityId: p.leadId };
  return null;
}
