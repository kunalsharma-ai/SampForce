import { Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  FIRST_EMAIL_STATUSES,
  type FirstEmailList,
  type firstEmailQuerySchema,
  type FirstEmailRow,
  type FirstEmailStatus,
  type InitialEmailSource,
  startOfDayIn,
} from '@dealflow/types';
import type { z } from 'zod';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { resolvedCadences } from './cadence-state';
import { contactScope, personRefs, scopeOf, visibility } from './visibility';

type Query = z.output<typeof firstEmailQuerySchema>;
const DAY = 86_400_000;
const unset = (field: string): Prisma.ContactWhereInput[] => [{ [field]: null }, { [field]: { isSet: false } }];
/** Email checks that mean the address will not reach anyone (Contact.emailStatus). */
const BAD_EMAIL = ['invalid', 'bounced'];
/** Stages before any outreach: a contact here, with no first email, is pending (ADR 0083's Fresh Email Pending). */
const BEFORE_OUTREACH_KEYS = ['NEW_CONTACT', 'FRESH_EMAIL_PENDING'];

/**
 * First Email Pending (ADR 0096): every contact whose first email has not gone out, whoever created them and however
 * (by hand, a company form, an import, an integration), and the contacts who had it and wait for follow-up 1. A
 * contact is in exactly one place: here until follow-up 1 is created, then in the Follow-ups lists.
 */
@Injectable()
export class FirstEmailService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: AuthContext, q: Query): Promise<FirstEmailList> {
    return this.prisma.run(auth, async (tx) => {
      const base = await this.baseWhere(tx, auth, q);
      // "Created today" counts today's contacts whatever creation dates the list shows.
      const undated = await this.baseWhere(tx, auth, { ...q, period: 'all', from: undefined, to: undefined });
      const pending = await this.pendingWhere(tx, auth.tenantId);
      const where = (s: FirstEmailStatus): Prisma.ContactWhereInput => ({ AND: [base, statusWhere(s, pending)] });
      const today = startOfDayIn(new Date(), q.tz);
      const [counts, createdToday] = await Promise.all([
        Promise.all(FIRST_EMAIL_STATUSES.map((s) => tx.contact.count({ where: where(s) }))),
        tx.contact.count({ where: { AND: [undated, { createdAt: { gte: today } }, { OR: (['PENDING', 'NO_EMAIL', 'INVALID_EMAIL'] as const).map((s) => statusWhere(s, pending)) }] } }),
      ]);
      const statuses = q.status ? [q.status] : (['PENDING', 'NO_EMAIL', 'INVALID_EMAIL'] as const);
      const listWhere: Prisma.ContactWhereInput = { AND: [base, { OR: statuses.map((s) => statusWhere(s, pending)) }] };
      const contacts = await tx.contact.findMany({
        where: listWhere,
        orderBy: [{ createdAt: 'desc' }],
        take: q.limit,
        select: {
          id: true, firstName: true, lastName: true, jobTitle: true, email: true, emailStatus: true, companyId: true, ownerId: true, createdAt: true,
          initialEmailAt: true, initialEmailSource: true, cadenceMovesAt: true, nextFollowUpAt: true,
        },
      });
      const total = q.status ? counts[FIRST_EMAIL_STATUSES.indexOf(q.status)]! : counts[0]! + counts[1]! + counts[2]!;
      return {
        rows: await this.rows(tx, auth.tenantId, contacts),
        total,
        counts: { ...(Object.fromEntries(FIRST_EMAIL_STATUSES.map((s, i) => [s, counts[i]!])) as Record<FirstEmailStatus, number>), createdToday },
      };
    });
  }

  /** Who and when: the caller's scope, the creation period and the owner and company filters. */
  private async baseWhere(tx: TenantTx, auth: AuthContext, q: Query): Promise<Prisma.ContactWhereInput> {
    const and: Prisma.ContactWhereInput[] = [{ tenantId: auth.tenantId, deletedAt: null }];
    const v = await visibility(tx, auth);
    if (q.scope === 'mine') and.push({ ownerId: auth.userId });
    else if (!(q.scope === 'all' && scopeOf(auth) === 'ALL' && v.all)) and.push(contactScope(v));
    if (q.ownerId) and.push({ ownerId: q.ownerId });
    if (q.companyId) and.push({ companyId: q.companyId });
    const range = createdRange(q);
    if (range) and.push({ createdAt: range });
    if (q.q) {
      const like = { contains: q.q, mode: 'insensitive' as const };
      const companies = await tx.company.findMany({ where: { tenantId: auth.tenantId, deletedAt: null, name: like }, select: { id: true }, take: 200 });
      and.push({ OR: [{ firstName: like }, { lastName: like }, { email: like }, { jobTitle: like }, ...(companies.length ? [{ companyId: { in: companies.map((c) => c.id) } }] : [])] });
    }
    return { AND: and };
  }

  /** No first email yet, the cadence never stopped, and the contact is not past outreach (a reply, an RFQ, a deal stage). */
  private async pendingWhere(tx: TenantTx, tenantId: string): Promise<Prisma.ContactWhereInput> {
    const early = await tx.crmStatus.findMany({ where: { tenantId, kind: 'STAGE', key: { in: BEFORE_OUTREACH_KEYS } }, select: { id: true } });
    return {
      AND: [
        { OR: unset('initialEmailAt') },
        { OR: unset('cadenceStoppedAt') },
        { OR: [...unset('stageId'), ...(early.length ? [{ stageId: { in: early.map((s) => s.id) } }] : [])] },
      ],
    };
  }

  private async rows(
    tx: TenantTx,
    tenantId: string,
    contacts: {
      id: string; firstName: string; lastName: string | null; jobTitle: string | null; email: string | null; emailStatus: string | null; companyId: string | null; ownerId: string | null; createdAt: Date;
      initialEmailAt: Date | null; initialEmailSource: string | null; cadenceMovesAt: Date | null; nextFollowUpAt: Date | null;
    }[],
  ): Promise<FirstEmailRow[]> {
    if (!contacts.length) return [];
    const ids = contacts.map((c) => c.id);
    const companyIds = [...new Set(contacts.map((c) => c.companyId).filter((v): v is string => !!v))];
    const [companies, people, cadences, last] = await Promise.all([
      companyIds.length ? tx.company.findMany({ where: { tenantId, id: { in: companyIds } }, select: { id: true, name: true } }) : [],
      personRefs(tx, tenantId, contacts.map((c) => c.ownerId)),
      resolvedCadences(tx, tenantId, contacts),
      tx.activity.groupBy({ by: ['contactId'], where: { tenantId, contactId: { in: ids } }, _max: { occurredAt: true } }),
    ]);
    const companyById = new Map(companies.map((c) => [c.id, c]));
    const lastBy = new Map(last.map((l) => [l.contactId, l._max.occurredAt]));
    return contacts.map((c) => {
      const cad = cadences.get(c.id)!;
      const status: FirstEmailStatus = c.initialEmailAt ? 'SENT' : !c.email?.trim() ? 'NO_EMAIL' : c.emailStatus && BAD_EMAIL.includes(c.emailStatus) ? 'INVALID_EMAIL' : 'PENDING';
      return {
        contactId: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' '),
        designation: c.jobTitle,
        email: c.email?.trim() || null,
        company: c.companyId ? (companyById.get(c.companyId) ?? null) : null,
        createdAt: c.createdAt.toISOString(),
        owner: c.ownerId ? (people.get(c.ownerId) ?? null) : null,
        status,
        sentAt: c.initialEmailAt?.toISOString() ?? null,
        sentSource: (c.initialEmailSource as InitialEmailSource | null) ?? null,
        lastActivityAt: lastBy.get(c.id)?.toISOString() ?? null,
        nextFollowUpAt: (status === 'SENT' ? c.cadenceMovesAt : c.nextFollowUpAt)?.toISOString() ?? null,
        cadence: { firstFollowUpDays: cad.firstFollowUpDays, channel: cad.channel, source: cad.source },
      };
    });
  }
}

function statusWhere(s: FirstEmailStatus, pending: Prisma.ContactWhereInput): Prisma.ContactWhereInput {
  const noEmail: Prisma.ContactWhereInput = { OR: [...unset('email'), { email: '' }] };
  const hasEmail: Prisma.ContactWhereInput = { email: { not: null, notIn: [''] } };
  switch (s) {
    case 'PENDING':
      return { AND: [pending, hasEmail, { OR: [...unset('emailStatus'), { emailStatus: { notIn: BAD_EMAIL } }] }] };
    case 'NO_EMAIL':
      return { AND: [pending, noEmail] };
    case 'INVALID_EMAIL':
      return { AND: [pending, hasEmail, { emailStatus: { in: BAD_EMAIL } }] };
    case 'SENT':
      // Sent and waiting for follow-up 1: cadenceMovesAt is cleared when it moves or the cadence stops.
      return { cadenceMovesAt: { not: null }, initialEmailAt: { not: null } };
  }
}

/** Creation dates for the period or the from/to days, in the caller's time zone. */
function createdRange(q: Query): Prisma.DateTimeFilter | null {
  const now = new Date();
  const today = startOfDayIn(now, q.tz);
  const range: Prisma.DateTimeFilter = {};
  switch (q.period) {
    case 'today':
      range.gte = today;
      break;
    case 'yesterday':
      range.gte = startOfDayIn(new Date(today.getTime() - DAY / 2), q.tz);
      range.lt = today;
      break;
    case 'week': {
      // Weeks start on Monday.
      const weekday = (localDate(now, q.tz).getUTCDay() + 6) % 7;
      range.gte = startOfDayIn(new Date(today.getTime() - weekday * DAY + DAY / 2), q.tz);
      break;
    }
    case 'month': {
      const dom = localDate(now, q.tz).getUTCDate();
      range.gte = startOfDayIn(new Date(today.getTime() - (dom - 1) * DAY + DAY / 2), q.tz);
      break;
    }
    case 'all':
      break;
  }
  if (q.from) {
    const from = dayStart(q.from, q.tz);
    if (!range.gte || from > (range.gte as Date)) range.gte = from;
  }
  if (q.to) {
    const next = new Date(`${q.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const to = dayStart(next.toISOString().slice(0, 10), q.tz);
    if (!range.lt || to < (range.lt as Date)) range.lt = to;
  }
  return Object.keys(range).length ? range : null;
}

/** The calendar date of `at` in `tz`, as midnight UTC of that date. */
function localDate(at: Date, tz: string): Date {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  return new Date(`${p}T00:00:00Z`);
}

/** The start of a YYYY-MM-DD day in `tz`. */
function dayStart(day: string, tz: string): Date {
  const noon = new Date(`${day}T12:00:00Z`);
  let start = startOfDayIn(noon, tz);
  // Zones far east of UTC are already on the next day at noon UTC.
  if (localDate(start, tz).toISOString().slice(0, 10) !== day) start = startOfDayIn(new Date(noon.getTime() - DAY), tz);
  return start;
}
