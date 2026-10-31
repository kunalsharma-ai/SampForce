import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { formatReference, type TimelineEntity, type TimelineItem, type TimelineKind, type TimelinePage, type TimelineQuery } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';

/** The permission each source needs, on top of read access to the record itself. */
const SOURCE_PERMISSION: Record<TimelineKind, string> = {
  created: '',
  activity: 'activities:read',
  email: 'activities:read',
  meeting: 'activities:read',
  sequence_email: 'sequences:read',
  email_event: 'sequences:read',
  stage_change: 'deals:read',
  task_done: 'activities:read',
  quote: 'quotes:read',
  contract: 'contracts:read',
  form: 'marketing:read',
  escalation: 'success:read',
};

const ENTITY_PERMISSION: Record<TimelineEntity, string> = { lead: 'leads:read', contact: 'contacts:read', company: 'companies:read', deal: 'deals:read' };

const SOURCE_LABEL: Record<string, string> = { 'Browser extension': 'the browser extension', 'Email finder': 'the email finder' };

interface Scope {
  name: string;
  createdAt: Date;
  createdDetail: string | null;
  leadIds: string[];
  contactIds: string[];
  dealIds: string[];
  companyIds: string[];
  /** Names for "about" labels on company and deal timelines. */
  names: Map<string, { type: 'lead' | 'contact' | 'deal'; name: string }>;
}

const personName = (c: { firstName: string; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(' ');

/**
 * Customer 360 timeline (enhancement spec feature 2): one chronological stream per lead, contact, company or deal,
 * merged from the records DealFlow already keeps. A company's timeline rolls up its contacts and deals; a deal's
 * includes its main contact's email and meetings. Each source is shown only to people allowed to read it.
 */
@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  get(auth: AuthContext, entity: TimelineEntity, id: string, q: TimelineQuery): Promise<TimelinePage> {
    if (!auth.permissions.includes(ENTITY_PERMISSION[entity])) throw notFound(entity === 'deal' ? 'Deal' : entity[0]!.toUpperCase() + entity.slice(1));
    return this.prisma.run(auth, async (tx) => {
      const scope = await this.scope(tx, auth.tenantId, entity, id);
      const wanted = (q.kinds?.length ? q.kinds : (Object.keys(SOURCE_PERMISSION) as TimelineKind[])).filter((k) => {
        const p = SOURCE_PERMISSION[k];
        return !p || auth.permissions.includes(p);
      });
      const hidden = (Object.keys(SOURCE_PERMISSION) as TimelineKind[]).filter((k) => SOURCE_PERMISSION[k] && !auth.permissions.includes(SOURCE_PERMISSION[k]));
      const before = q.before ? new Date(q.before) : new Date(Date.now() + 60_000);
      const take = q.limit + 1;
      const items = (await Promise.all(wanted.map((k) => this.source(tx, auth.tenantId, k, entity, id, scope, before, take)))).flat();
      items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
      const page = items.slice(0, q.limit);
      const actors = await ownerRefs(tx, page.map((i) => i.actor?.id));
      for (const i of page) if (i.actor) i.actor = actors.get(i.actor.id) ?? null;
      return { items: page, nextBefore: items.length > q.limit ? page[page.length - 1]!.at : null, hidden };
    });
  }

  private async scope(tx: TenantTx, tenantId: string, entity: TimelineEntity, id: string): Promise<Scope> {
    const names = new Map<string, { type: 'lead' | 'contact' | 'deal'; name: string }>();
    const created = (source: string | null | undefined) => (source ? `Source: ${SOURCE_LABEL[source] ?? source}` : null);
    if (entity === 'lead') {
      const l = await tx.lead.findFirst({ where: { id, tenantId, deletedAt: null }, select: { fullName: true, createdAt: true, source: true, convertedContactId: true } });
      if (!l) throw notFound('Lead');
      return { name: l.fullName, createdAt: l.createdAt, createdDetail: created(l.source), leadIds: [id], contactIds: [], dealIds: [], companyIds: [], names };
    }
    if (entity === 'contact') {
      const c = await tx.contact.findFirst({ where: { id, tenantId, deletedAt: null }, select: { firstName: true, lastName: true, createdAt: true } });
      if (!c) throw notFound('Contact');
      // A contact converted from a lead keeps the lead's history.
      const leads = await tx.lead.findMany({ where: { tenantId, convertedContactId: id }, select: { id: true, fullName: true } });
      for (const l of leads) names.set(l.id, { type: 'lead', name: `${l.fullName} (as a lead)` });
      return { name: personName(c), createdAt: c.createdAt, createdDetail: null, leadIds: leads.map((l) => l.id), contactIds: [id], dealIds: [], companyIds: [], names };
    }
    if (entity === 'deal') {
      const d = await tx.opportunity.findFirst({ where: { id, tenantId, deletedAt: null }, select: { name: true, createdAt: true, contactId: true, companyId: true, contact: { select: { firstName: true, lastName: true } } } });
      if (!d) throw notFound('Deal');
      if (d.contactId && d.contact) names.set(d.contactId, { type: 'contact', name: personName(d.contact) });
      return { name: d.name, createdAt: d.createdAt, createdDetail: null, leadIds: [], contactIds: d.contactId ? [d.contactId] : [], dealIds: [id], companyIds: [], names };
    }
    const co = await tx.company.findFirst({ where: { id, tenantId, deletedAt: null }, select: { name: true, createdAt: true } });
    if (!co) throw notFound('Company');
    const [contacts, deals] = await Promise.all([
      tx.contact.findMany({ where: { tenantId, companyId: id, deletedAt: null }, select: { id: true, firstName: true, lastName: true }, take: 500 }),
      tx.opportunity.findMany({ where: { tenantId, companyId: id, deletedAt: null }, select: { id: true, name: true }, take: 500 }),
    ]);
    for (const c of contacts) names.set(c.id, { type: 'contact', name: personName(c) });
    for (const d of deals) names.set(d.id, { type: 'deal', name: d.name });
    return { name: co.name, createdAt: co.createdAt, createdDetail: null, leadIds: [], contactIds: contacts.map((c) => c.id), dealIds: deals.map((d) => d.id), companyIds: [id], names };
  }

  private async source(tx: TenantTx, tenantId: string, kind: TimelineKind, entity: TimelineEntity, id: string, s: Scope, before: Date, take: number): Promise<TimelineItem[]> {
    const about = (...ids: (string | null | undefined)[]): TimelineItem['about'] => {
      for (const x of ids) {
        if (!x || x === id) continue;
        const n = s.names.get(x);
        if (n) return { type: n.type, id: x, name: n.name };
      }
      return null;
    };
    const anyOf = <T extends object>(parts: (T | false)[]) => parts.filter((p): p is T => !!p);
    const people = anyOf([s.leadIds.length > 0 && { leadId: { in: s.leadIds } }, s.contactIds.length > 0 && { contactId: { in: s.contactIds } }]);

    switch (kind) {
      case 'created':
        return s.createdAt < before
          ? [{ id: `created:${id}`, kind, at: s.createdAt.toISOString(), title: `${s.name} was added`, detail: s.createdDetail, actor: null, about: null, href: null }]
          : [];

      case 'activity': {
        const where = anyOf([
          ...people,
          s.dealIds.length > 0 && { opportunityId: { in: s.dealIds } },
          s.companyIds.length > 0 && { companyId: { in: s.companyIds } },
        ]);
        if (!where.length) return [];
        const rows = await tx.activity.findMany({ where: { tenantId, deletedAt: null, occurredAt: { lt: before }, OR: where }, orderBy: { occurredAt: 'desc' }, take });
        return rows.map((a) => ({
          id: `activity:${a.id}`, kind, at: a.occurredAt.toISOString(), title: `${a.type[0]}${a.type.slice(1).toLowerCase()}: ${a.subject}`, detail: a.body?.slice(0, 500) ?? null,
          actor: a.ownerId ? { id: a.ownerId, name: '' } : null, about: about(a.contactId, a.leadId, a.opportunityId), href: null,
        }));
      }

      case 'email': {
        if (!people.length) return [];
        // Sequence sends are shown as sequence emails instead, with their opens and replies.
        const viaSequence = (
          await tx.sequenceMessage.findMany({ where: { tenantId, emailMessageId: { not: null }, enrollment: { OR: people } }, select: { emailMessageId: true }, take: 2000 })
        ).map((m) => m.emailMessageId!);
        const rows = await tx.emailMessage.findMany({
          where: { tenantId, sentAt: { lt: before }, OR: people, ...(viaSequence.length ? { id: { notIn: viaSequence } } : {}) },
          orderBy: { sentAt: 'desc' },
          take,
          select: { id: true, direction: true, subject: true, snippet: true, sentAt: true, fromAddress: true, contactId: true, leadId: true, connection: { select: { userId: true } } },
        });
        return rows.map((m) => ({
          id: `email:${m.id}`, kind, at: m.sentAt.toISOString(), direction: m.direction === 'INBOUND' ? 'in' : 'out',
          title: m.direction === 'INBOUND' ? `Email from ${m.fromAddress}: ${m.subject || '(no subject)'}` : `Email sent: ${m.subject || '(no subject)'}`,
          detail: m.snippet ?? null, actor: m.direction === 'OUTBOUND' ? { id: m.connection.userId, name: '' } : null, about: about(m.contactId, m.leadId), href: null,
        }));
      }

      case 'meeting': {
        if (!s.contactIds.length) return [];
        const rows = await tx.meeting.findMany({ where: { tenantId, canceled: false, startsAt: { lt: before }, contactIds: { hasSome: s.contactIds } }, orderBy: { startsAt: 'desc' }, take });
        return rows.map((m) => ({
          id: `meeting:${m.id}`, kind, at: m.startsAt.toISOString(), title: `Meeting: ${m.title}`, detail: m.location ?? null, actor: null,
          about: about(...m.contactIds.filter((c) => s.contactIds.includes(c))), href: '/app/meetings',
        }));
      }

      case 'sequence_email': {
        if (!people.length) return [];
        const rows = await tx.sequenceMessage.findMany({
          where: { tenantId, sentAt: { lt: before }, enrollment: { OR: people } },
          orderBy: { sentAt: 'desc' },
          take,
          select: { id: true, subject: true, sentAt: true, senderId: true, repliedAt: true, enrollment: { select: { sequenceId: true, leadId: true, contactId: true, sequence: { select: { name: true } } } } },
        });
        return rows.map((m) => ({
          id: `sequence_email:${m.id}`, kind, at: m.sentAt.toISOString(), direction: 'out' as const,
          title: `Sequence "${m.enrollment.sequence.name}": ${m.subject}`, detail: m.repliedAt ? `Replied ${m.repliedAt.toISOString().slice(0, 10)}` : null,
          actor: { id: m.senderId, name: '' }, about: about(m.enrollment.contactId, m.enrollment.leadId), href: `/app/sequences/${m.enrollment.sequenceId}`,
        }));
      }

      case 'email_event': {
        if (!people.length) return [];
        const rows = await tx.emailEvent.findMany({
          // Replies already show as emails; opens are approximate and labelled so.
          where: { tenantId, type: { in: ['OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED'] }, createdAt: { lt: before }, message: { enrollment: { OR: people } } },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, type: true, url: true, createdAt: true, message: { select: { subject: true, enrollment: { select: { leadId: true, contactId: true } } } } },
        });
        const label = { OPENED: 'Opened (approximate)', CLICKED: 'Clicked a link in', BOUNCED: 'Bounced:', UNSUBSCRIBED: 'Unsubscribed from', REPLIED: 'Replied to' } as const;
        return rows.map((e) => ({
          id: `email_event:${e.id}`, kind, at: e.createdAt.toISOString(), title: `${label[e.type]} "${e.message.subject}"`, detail: e.type === 'CLICKED' ? e.url : null,
          actor: null, about: about(e.message.enrollment.contactId, e.message.enrollment.leadId), href: null,
        }));
      }

      case 'stage_change': {
        if (!s.dealIds.length) return [];
        const rows = await tx.dealStageEvent.findMany({ where: { tenantId, opportunityId: { in: s.dealIds }, occurredAt: { lt: before } }, orderBy: { occurredAt: 'desc' }, take });
        const stages = new Map(
          (await tx.pipelineStage.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.toStageId, r.fromStageId].filter((x): x is string => !!x)))] } }, select: { id: true, name: true } })).map((st) => [st.id, st.name]),
        );
        return rows.map((r) => ({
          id: `stage_change:${r.id}`, kind, at: r.occurredAt.toISOString(),
          title: r.fromStageId ? `Moved from ${stages.get(r.fromStageId) ?? 'a stage'} to ${stages.get(r.toStageId) ?? 'a stage'}` : `Started in ${stages.get(r.toStageId) ?? 'a stage'}`,
          detail: r.reconstructed ? 'Reconstructed from the audit log' : null, actor: r.actorUserId ? { id: r.actorUserId, name: '' } : null, about: about(r.opportunityId), href: null,
        }));
      }

      case 'task_done': {
        const where = anyOf([...people, s.dealIds.length > 0 && { opportunityId: { in: s.dealIds } }]);
        if (!where.length) return [];
        const rows = await tx.task.findMany({ where: { tenantId, deletedAt: null, status: 'DONE', completedAt: { lt: before }, OR: where }, orderBy: { completedAt: 'desc' }, take });
        return rows.map((t) => ({
          id: `task_done:${t.id}`, kind, at: t.completedAt!.toISOString(), title: `Task done: ${t.title}`, detail: null,
          actor: t.assigneeId ? { id: t.assigneeId, name: '' } : null, about: about(t.contactId, t.leadId, t.opportunityId), href: null,
        }));
      }

      case 'quote': {
        if (!s.dealIds.length) return [];
        const rows = await tx.quote.findMany({ where: { tenantId, opportunityId: { in: s.dealIds }, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take });
        return rows.map((q) => ({
          id: `quote:${q.id}`, kind, at: (q.decidedAt ?? q.sentAt ?? q.createdAt).toISOString(),
          title: `Quote ${formatReference('Q', q.number, q.version)} ${q.status.toLowerCase().replace('_', ' ')}`, detail: `${q.currency} ${q.total.toFixed(2)}`,
          actor: q.createdById ? { id: q.createdById, name: '' } : null, about: about(q.opportunityId), href: `/app/quotes/${q.id}`,
        })).filter((i) => i.at < before.toISOString());
      }

      case 'contract': {
        const where = anyOf([s.dealIds.length > 0 && { opportunityId: { in: s.dealIds } }, s.companyIds.length > 0 && { companyId: { in: s.companyIds } }]);
        if (!where.length) return [];
        const rows = await tx.contract.findMany({ where: { tenantId, createdAt: { lt: before }, OR: where }, orderBy: { createdAt: 'desc' }, take });
        return rows.map((c) => ({
          id: `contract:${c.id}`, kind, at: (c.signedAt ?? c.createdAt).toISOString(),
          title: `Contract ${formatReference('C', c.number)} ${c.name}: ${c.status.toLowerCase()}`, detail: c.endDate ? `Runs to ${c.endDate.toISOString().slice(0, 10)}` : null,
          actor: c.ownerId ? { id: c.ownerId, name: '' } : null, about: about(c.opportunityId), href: `/app/contracts/${c.id}`,
        })).filter((i) => i.at < before.toISOString());
      }

      case 'form': {
        if (!s.leadIds.length) return [];
        const rows = await tx.formSubmission.findMany({ where: { tenantId, leadId: { in: s.leadIds }, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take, include: { form: { select: { name: true } } } });
        return rows.map((f) => ({
          id: `form:${f.id}`, kind, at: f.createdAt.toISOString(), title: `Submitted the form "${f.form.name}"`, detail: f.consent ? 'Gave marketing consent' : null,
          actor: null, about: about(f.leadId), href: null,
        }));
      }

      case 'escalation': {
        if (!s.companyIds.length) return [];
        const rows = await tx.escalation.findMany({ where: { tenantId, companyId: { in: s.companyIds }, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take });
        return rows.map((e) => ({
          id: `escalation:${e.id}`, kind, at: e.createdAt.toISOString(), title: `${e.severity[0]}${e.severity.slice(1).toLowerCase()} escalation: ${e.title}`,
          detail: e.status === 'RESOLVED' ? `Resolved: ${e.resolution ?? ''}` : null, actor: e.openedById ? { id: e.openedById, name: '' } : null, about: null, href: `/app/customer-success?company=${e.companyId}`,
        }));
      }
    }
  }
}
