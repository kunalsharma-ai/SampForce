import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CRM_STATUS_KINDS,
  DEFAULT_DEPARTMENTS,
  DEFAULT_DESIGNATIONS,
  DEFAULT_STATUSES,
  SYSTEM_ROLE_DEFINITIONS,
  companyNameKey,
  defaultLeadPrefix,
  formatLeadNumber,
  matchKeys,
  type ContactPoint,
} from '@dealflow/types';
import { nextSequenceValue, withDbContext, type TenantTx } from './client';

/*
 * Company-centric CRM data (ADR 0060): workspace defaults, lead numbers and the one-off upgrade of existing data.
 */

/** Creates the default statuses, designations and departments a workspace does not have yet. Idempotent. */
export async function ensureCompanyCrmDefaults(tx: TenantTx, tenantId: string, say: (english: string) => string = (s) => s): Promise<void> {
  for (const kind of CRM_STATUS_KINDS) {
    if (await tx.crmStatus.count({ where: { tenantId, kind } })) continue;
    await tx.crmStatus.createMany({
      data: DEFAULT_STATUSES[kind].map((s, position) => ({
        tenantId, kind, name: say(s.name), color: s.color, meaning: s.meaning, position, isDefault: position === 0, description: null, archivedAt: null,
      })),
    });
  }
  if (!(await tx.designation.count({ where: { tenantId } }))) {
    await tx.designation.createMany({
      data: DEFAULT_DESIGNATIONS.map((d, position) => ({ tenantId, name: say(d.name), tier: d.tier, position, description: null, archivedAt: null })),
    });
  }
  if (!(await tx.department.count({ where: { tenantId } }))) {
    await tx.department.createMany({ data: DEFAULT_DEPARTMENTS.map((name, position) => ({ tenantId, name: say(name), position, description: null, archivedAt: null })) });
  }
}

export async function leadNumbering(tx: TenantTx, tenantId: string): Promise<{ prefix: string; digits: number; isDefaultPrefix: boolean }> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, leadNumberPrefix: true, leadNumberDigits: true } });
  return { prefix: t.leadNumberPrefix ?? defaultLeadPrefix(t.name), digits: t.leadNumberDigits, isDefaultPrefix: !t.leadNumberPrefix };
}

/**
 * Gives every company of the workspace that has no lead number one, oldest first, from the workspace's counter. A
 * number is never reused (deleted companies keep theirs) and the unique index stops two companies sharing one.
 */
export async function assignLeadNumbers(tx: TenantTx, tenantId: string, limit = 500): Promise<number> {
  const pending = await tx.company.findMany({
    where: { tenantId, OR: [{ leadSeq: null }, { leadSeq: { isSet: false } }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: limit,
  });
  if (!pending.length) return 0;
  const { prefix, digits } = await leadNumbering(tx, tenantId);
  for (const c of pending) {
    const seq = await nextSequenceValue(tx, `lead:${tenantId}`);
    await tx.company.update({ where: { id: c.id }, data: { leadSeq: seq, leadNumber: formatLeadNumber(prefix, seq, digits) } });
  }
  return pending.length;
}

export function points(list: unknown): ContactPoint[] {
  return Array.isArray(list) ? (list as ContactPoint[]).filter((p) => p && typeof p.value === 'string') : [];
}

/** Duplicate keys of a company document (stored as match_keys). */
export function companyMatchKeys(c: { domain?: string | null; website?: string | null; primaryEmail?: string | null; primaryPhone?: string | null; linkedinUrl?: string | null; emails?: unknown; phones?: unknown; websites?: unknown; linkedinUrls?: unknown }): string[] {
  return matchKeys({
    websites: [c.website, c.domain, ...points(c.websites).map((p) => p.value)],
    emails: [c.primaryEmail, ...points(c.emails).map((p) => p.value)],
    phones: [c.primaryPhone, ...points(c.phones).map((p) => p.value)],
    linkedin: [c.linkedinUrl, ...points(c.linkedinUrls).map((p) => p.value)],
    emailDomains: true,
  });
}

export function contactMatchKeys(c: { email?: string | null; phone?: string | null; linkedinUrl?: string | null; emails?: unknown; phones?: unknown }): string[] {
  return matchKeys({
    emails: [c.email, ...points(c.emails).map((p) => p.value)],
    phones: [c.phone, ...points(c.phones).map((p) => p.value)],
    linkedin: [c.linkedinUrl],
  });
}

const UPGRADE_MARKER = (tenantId: string) => `upgrade:company-crm-1:${tenantId}`;

/**
 * One-off upgrade of a workspace that existed before the company-centric CRM. Run by `db:setup` on every deploy;
 * each workspace is upgraded once (a marker in the counters collection), so administrators' later changes to role
 * visibility are never undone. Nothing is deleted:
 *  - default statuses, designations and departments;
 *  - system roles get permissions added since they were created, and the default record visibility;
 *  - companies get lead numbers in creation order, a status (Existing Client with a won deal, else New Lead), a
 *    creator (who created them according to the audit log, else the owner) and duplicate keys;
 *  - contacts get the default employee status, their email and phone as the primary entries, and duplicate keys.
 * Lead numbers are also assigned on later runs to any company that has none (records written by older code).
 */
export async function upgradeCompanyCrm(prisma: PrismaClient, log: (line: string) => void = () => {}): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const { id: tenantId } of tenants) {
    // The bulk updates run outside a transaction (a large workspace would exceed MongoDB's transaction limits);
    // each step is idempotent, so an interrupted upgrade simply runs again. The marker is written last.
    const marker = await prisma.counter.findUnique({ where: { id: UPGRADE_MARKER(tenantId) } });
    if (!marker) {
      await upgradeTenant(prisma as unknown as TenantTx, tenantId);
      log(`upgraded ${tenantId} to the company-centric CRM`);
    }
    let numbered = 0;
    for (let n = 1; n > 0; numbered += n) n = await withDbContext(prisma, { system: true }, (tx) => assignLeadNumbers(tx, tenantId));
    if (!marker) await prisma.counter.create({ data: { id: UPGRADE_MARKER(tenantId), value: 1 } });
    if (numbered) log(`numbered ${numbered} company leads in ${tenantId}`);
  }
}

/** Permissions introduced by the company-centric CRM. */
const NEW_PERMISSIONS = ['crm:configure'];

async function upgradeTenant(tx: TenantTx, tenantId: string): Promise<void> {
  await ensureCompanyCrmDefaults(tx, tenantId);
  // Existing workspaces keep what each role sees today (ALL, with details): narrowing it is the admin's choice in Team
  // settings. Only the new permission is added, so a permission an admin removed on purpose stays removed.
  for (const role of await tx.role.findMany({ where: { tenantId, isSystem: true } })) {
    const def = SYSTEM_ROLE_DEFINITIONS[role.key as keyof typeof SYSTEM_ROLE_DEFINITIONS];
    if (!def) continue;
    const added = NEW_PERMISSIONS.filter((p) => (def.permissions as readonly string[]).includes(p) && !role.permissions.includes(p));
    if (added.length) await tx.role.update({ where: { id: role.id }, data: { permissions: [...role.permissions, ...added] } });
  }
  const statuses = await tx.crmStatus.findMany({ where: { tenantId } });
  const pick = (kind: string, name: string) => statuses.find((s) => s.kind === kind && s.name === name) ?? statuses.find((s) => s.kind === kind && s.isDefault);
  const newLead = pick('COMPANY', 'New Lead');
  const client = pick('COMPANY', 'Existing Client');
  const newContact = pick('EMPLOYEE', 'New Contact');

  const creators = new Map(
    (await tx.auditLog.findMany({ where: { tenantId, action: 'company.created' }, select: { entityId: true, actorUserId: true } })).map((a) => [a.entityId, a.actorUserId]),
  );
  const won = new Set(
    (await tx.opportunity.findMany({ where: { tenantId, status: 'WON', deletedAt: null, companyId: { not: null } }, select: { companyId: true } })).map((o) => o.companyId),
  );
  const companies = await tx.company.findMany({ where: { tenantId } });
  for (const c of companies) {
    await tx.company.update({
      where: { id: c.id },
      data: {
        ...(c.statusId ? {} : { statusId: (won.has(c.id) ? client : newLead)?.id ?? null, statusChangedAt: c.createdAt }),
        ...(c.createdById ? {} : { createdById: creators.get(c.id) ?? c.ownerId ?? null }),
        ...(c.website || !c.domain ? {} : { website: `https://${c.domain.replace(/^https?:\/\//, '')}` }),
        nameKey: companyNameKey(c.name),
        matchKeys: companyMatchKeys(c),
      },
    });
  }
  const contacts = await tx.contact.findMany({ where: { tenantId } });
  for (const c of contacts) {
    const emails = points(c.emails).length ? points(c.emails) : c.email ? [{ value: c.email, primary: true }] : [];
    const phones = points(c.phones).length ? points(c.phones) : c.phone ? [{ value: c.phone, primary: true }] : [];
    await tx.contact.update({
      where: { id: c.id },
      data: {
        ...(c.statusId ? {} : { statusId: newContact?.id ?? null, statusChangedAt: c.createdAt }),
        ...(c.createdById ? {} : { createdById: c.ownerId ?? null }),
        emails: emails as unknown as Prisma.InputJsonValue,
        phones: phones as unknown as Prisma.InputJsonValue,
        matchKeys: contactMatchKeys({ ...c, emails, phones }),
      },
    });
  }
}
