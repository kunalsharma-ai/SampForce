import { BadRequestException, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  type DealHealth,
  formatReference,
  type NextAction,
  type NextActionAcceptInput,
  type NextActionDismissInput,
  type NextActionFocus,
  type NextActionList,
  type NextActionRecordType,
  type Signal,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { TasksService } from '../crm/tasks.service';

const DAY = 86_400_000;

interface Focus {
  leadIds: string[];
  contactIds: string[];
  dealIds: string[];
  companyIds: string[];
}
const LIMIT = 25;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysSince = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);

/**
 * Priorities, highest first. Each item's `reason` says which rule produced it, so the list explains itself.
 * One item per record: when several rules match the same record, the highest wins.
 */
export const NEXT_ACTION_RULES = {
  reply_waiting: { base: 90, note: 'Someone wrote to you in the last 14 days and has no answer yet' },
  escalate_deal: { base: 78, note: 'A high-risk deal is among the largest quarter of open deals in its currency: worth a manager review' },
  overdue_task: { base: 80, note: 'Your open task is past its due date (+1 a day, up to +10)' },
  deal_at_risk: { base: 75, note: 'Your open deal scores high risk in the deal health monitor' },
  ai_recommendation: { base: 72, note: 'Deal Intelligence suggested a next step you have not accepted or dismissed' },
  close_date_passed: { base: 70, note: "Your open deal's expected close date has passed" },
  renewal_due: { base: 70, note: 'A contract you own ends within 30 days and has no renewal yet' },
  quote_awaiting_answer: { base: 65, note: 'A quote was sent 5 or more days ago and is not accepted or declined' },
  new_lead_untouched: { base: 60, note: 'A lead assigned to you is still New with nothing logged after a day' },
  prospect_silent: { base: 55, note: 'Someone finished one of your sequences in the last 14 days without replying: try another channel' },
  deal_no_next_step: { base: 50, note: 'Your open deal has no open task' },
} as const;

/** What to do about a high-risk deal, from its biggest risk signal. */
function riskTask(signals: Signal[], deal: string): string {
  const top = [...signals].sort((a, b) => a.points - b.points)[0]?.key;
  switch (top) {
    case 'stale':
    case 'quiet':
    case 'no_activity':
      return `Get back in touch about ${deal}`;
    case 'close_date_passed':
      return `Confirm a new close date for ${deal}`;
    case 'stuck':
      return `Move ${deal} forward or update its stage`;
    case 'no_contact':
      return `Add the main buyer to ${deal}`;
    case 'no_close_date':
      return `Agree an expected close date for ${deal}`;
    default:
      return `Plan the next step for ${deal}`;
  }
}

/**
 * Next best action engine (enhancement spec feature 3). A ranked "do this next" list for the person asking, built from
 * their own open work: replies, overdue tasks, the deal health monitor, Deal Intelligence suggestions, quotes, renewals
 * and new leads. Accepting creates a task through the normal task service; nothing is changed without that click.
 */
@Injectable()
export class NextActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The signed-in person's list, or with `focus` the actions for one record (whoever owns it), for record pages.
   * Items the person accepted, dismissed or snoozed (until the snooze ends) are left out.
   */
  async list(auth: AuthContext, focus?: NextActionFocus, now = new Date()): Promise<NextActionList> {
    const can = (p: string) => auth.permissions.includes(p);
    const candidates = await this.prisma.run(auth, async (tx) => this.collect(tx, auth, can, now, focus ? await this.focusScope(tx, auth.tenantId, focus) : null));
    const dismissals = await this.prisma.run(auth, (tx) =>
      tx.nextActionDecision.findMany({
        where: { tenantId: auth.tenantId, userId: auth.userId, OR: [{ decision: { in: ['accepted', 'dismissed'] } }, { until: { gt: now } }] },
        select: { key: true },
      }),
    );
    const hidden = new Set(dismissals.map((d) => d.key));
    const best = new Map<string, NextAction>();
    let dismissed = 0;
    for (const c of candidates) {
      if (hidden.has(c.key)) {
        dismissed++;
        continue;
      }
      const id = `${c.record.type}:${c.record.id}`;
      const prev = best.get(id);
      if (!prev || c.priority > prev.priority) best.set(id, c);
    }
    const items = [...best.values()].sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title)).slice(0, LIMIT);
    const outcomes = focus ? null : await this.outcomes(auth, now);
    return { items, dismissed, outcomes, generatedAt: now.toISOString() };
  }

  /** Records a lead, contact, company or deal page asks about, and the people and deals around it. */
  private async focusScope(tx: TenantTx, tenantId: string, f: NextActionFocus): Promise<Focus> {
    const none = { leadIds: [] as string[], contactIds: [] as string[], dealIds: [] as string[], companyIds: [] as string[] };
    if (f.type === 'lead') return { ...none, leadIds: [f.id] };
    if (f.type === 'deal') {
      const d = await tx.opportunity.findFirst({ where: { id: f.id, tenantId, deletedAt: null }, select: { contactId: true } });
      return { ...none, dealIds: d ? [f.id] : [], contactIds: d?.contactId ? [d.contactId] : [] };
    }
    if (f.type === 'contact') {
      const deals = await tx.opportunity.findMany({ where: { tenantId, contactId: f.id, deletedAt: null }, select: { id: true }, take: 200 });
      return { ...none, contactIds: [f.id], dealIds: deals.map((d) => d.id) };
    }
    const [contacts, deals] = await Promise.all([
      tx.contact.findMany({ where: { tenantId, companyId: f.id, deletedAt: null }, select: { id: true }, take: 500 }),
      tx.opportunity.findMany({ where: { tenantId, companyId: f.id, deletedAt: null }, select: { id: true }, take: 500 }),
    ]);
    return { ...none, companyIds: [f.id], contactIds: contacts.map((c) => c.id), dealIds: deals.map((d) => d.id) };
  }

  /**
   * Whether accepted suggestions led anywhere, over the last 30 days: the task created was completed, and the record
   * saw new engagement afterwards (an activity logged, an email received from its people, or a deal stage move).
   */
  private outcomes(auth: AuthContext, now: Date): Promise<NonNullable<NextActionList['outcomes']>> {
    return this.prisma.run(auth, async (tx) => {
      const since = new Date(now.getTime() - 30 * DAY);
      const rows = await tx.$queryRaw<{ accepted: number; done: number; engaged: number; dismissed: number }[]>`
        SELECT count(*) FILTER (WHERE d.decision = 'accepted')::int AS accepted,
               count(*) FILTER (WHERE d.decision = 'accepted' AND t.status = 'DONE')::int AS done,
               count(*) FILTER (WHERE d.decision = 'accepted' AND (
                 EXISTS (SELECT 1 FROM activities a WHERE a.deleted_at IS NULL AND a.created_at > d.created_at
                          AND ((d.record_type = 'deal' AND a.opportunity_id = d.record_id) OR (d.record_type = 'lead' AND a.lead_id = d.record_id)
                            OR (d.record_type = 'contact' AND a.contact_id = d.record_id) OR (d.record_type = 'company' AND a.company_id = d.record_id)))
                 OR EXISTS (SELECT 1 FROM email_messages m WHERE m.direction = 'INBOUND' AND m.sent_at > d.created_at
                          AND ((d.record_type = 'lead' AND m.lead_id = d.record_id) OR (d.record_type = 'contact' AND m.contact_id = d.record_id)))
                 OR EXISTS (SELECT 1 FROM deal_stage_events e WHERE d.record_type = 'deal' AND e.opportunity_id = d.record_id AND e.occurred_at > d.created_at)
               ))::int AS engaged,
               count(*) FILTER (WHERE d.decision <> 'accepted')::int AS dismissed
          FROM next_action_decisions d LEFT JOIN tasks t ON t.id = d.task_id
         WHERE d.tenant_id = ${auth.tenantId}::uuid AND d.user_id = ${auth.userId}::uuid AND d.created_at >= ${since}`;
      const r = rows[0]!;
      return { accepted30: r.accepted, tasksDone: r.done, engaged: r.engaged, dismissed30: r.dismissed };
    });
  }

  private async collect(tx: TenantTx, auth: AuthContext, can: (p: string) => boolean, now: Date, f: Focus | null): Promise<NextAction[]> {
    const t = auth.tenantId;
    const me = auth.userId;
    const out: NextAction[] = [];
    const push = (a: Omit<NextAction, 'recommendationId'> & { recommendationId?: string | null }) => out.push({ recommendationId: null, ...a });
    const href = (type: NextActionRecordType, id: string) =>
      ({ lead: `/app/leads/${id}`, contact: `/app/contacts/${id}`, company: `/app/companies/${id}`, deal: `/app/deals/${id}`, task: '/app/activities?tab=tasks', quote: `/app/quotes/${id}`, contract: `/app/contracts/${id}` })[type];

    if (can('activities:read')) {
      // Replies waiting: inbound mail to my mailbox from a known person, with nothing sent back in that thread since.
      const inbound = await tx.emailMessage.findMany({
        where: {
          tenantId: t, direction: 'INBOUND', sentAt: { gte: new Date(now.getTime() - 14 * DAY) },
          ...(f ? { OR: [{ contactId: { in: f.contactIds } }, { leadId: { in: f.leadIds } }] } : { connection: { userId: me }, OR: [{ contactId: { not: null } }, { leadId: { not: null } }] }),
        },
        orderBy: { sentAt: 'desc' },
        take: 100,
        select: { id: true, threadId: true, subject: true, sentAt: true, fromAddress: true, connectionId: true, contactId: true, leadId: true},
      });
      const seenThreads = new Set<string>();
      for (const m of inbound) {
        const thread = m.threadId ?? m.id;
        if (seenThreads.has(thread)) continue;
        seenThreads.add(thread);
        const answered = await tx.emailMessage.findFirst({
          where: { tenantId: t, connectionId: m.connectionId, direction: 'OUTBOUND', sentAt: { gt: m.sentAt }, ...(m.threadId ? { threadId: m.threadId } : { toAddresses: { has: m.fromAddress } }) },
          select: { id: true },
        });
        if (answered) continue;
        const type: NextActionRecordType = m.contactId ? 'contact' : 'lead';
        const id = (m.contactId ?? m.leadId)!;
        const person = m.contactId
          ? await tx.contact.findFirst({ where: { id: m.contactId, tenantId: t, deletedAt: null }, select: { firstName: true, lastName: true } })
          : await tx.lead.findFirst({ where: { id: m.leadId!, tenantId: t, deletedAt: null }, select: { fullName: true } });
        if (!person) continue;
        const name = 'fullName' in person ? person.fullName : [person.firstName, person.lastName].filter(Boolean).join(' ');
        push({
          key: `reply_waiting:${m.id}`, kind: 'reply_waiting', priority: NEXT_ACTION_RULES.reply_waiting.base - Math.min(10, daysSince(m.sentAt, now)),
          title: `Reply to ${name}`, reason: `"${m.subject || '(no subject)'}" arrived ${ymd(m.sentAt)} and has no answer yet.`,
          record: { type, id, name }, href: href(type, id), suggestedTask: null,
        });
      }

      const overdue = await tx.task.findMany({
        where: {
          tenantId: t, deletedAt: null, status: 'OPEN', dueAt: { lt: now },
          ...(f ? { OR: [{ leadId: { in: f.leadIds } }, { contactId: { in: f.contactIds } }, { opportunityId: { in: f.dealIds } }] } : { assigneeId: me }),
        },
        orderBy: { dueAt: 'asc' },
        take: 50,
        select: { id: true, title: true, dueAt: true },
      });
      for (const task of overdue) {
        const late = daysSince(task.dueAt!, now);
        push({
          key: `overdue_task:${task.id}`, kind: 'overdue_task', priority: NEXT_ACTION_RULES.overdue_task.base + Math.min(10, late),
          title: task.title, reason: late === 0 ? 'Due earlier today.' : `Overdue by ${late} day${late === 1 ? '' : 's'}.`,
          record: { type: 'task', id: task.id, name: task.title }, href: href('task', task.id), suggestedTask: null,
        });
      }
    }

    if (can('deals:read')) {
      const deals = await tx.opportunity.findMany({
        where: { tenantId: t, deletedAt: null, status: 'OPEN', ...(f ? { id: { in: f.dealIds } } : { ownerId: me }) },
        select: {
          id: true, name: true, expectedCloseDate: true, amount: true, currency: true,
          healthScore: { select: { health: true, risk: true, signals: true, computedAt: true } },
          _count: { select: { tasks: { where: { deletedAt: null, status: 'OPEN' } } } },
        },
        take: 500,
      });
      const today = ymd(now);
      // Top quarter of open deal amounts, per currency, across the workspace.
      const bigByCurrency = new Map(
        (await tx.$queryRaw<{ currency: string; p75: number }[]>`
          SELECT currency, percentile_cont(0.75) WITHIN GROUP (ORDER BY amount)::float AS p75
            FROM opportunities WHERE tenant_id = ${t}::uuid AND deleted_at IS NULL AND status = 'OPEN' GROUP BY currency HAVING count(*) >= 4`).map((r) => [r.currency, r.p75]),
      );
      for (const d of deals) {
        const rec = { type: 'deal' as const, id: d.id, name: d.name };
        const h = d.healthScore;
        if (h?.risk === 'high') {
          const signals = h.signals as unknown as Signal[];
          push({
            key: `deal_at_risk:${d.id}:${ymd(h.computedAt)}`, kind: 'deal_at_risk', priority: NEXT_ACTION_RULES.deal_at_risk.base + Math.round((100 - h.health) / 10),
            title: riskTask(signals, d.name), reason: `Health ${h.health}/100: ${signals.map((s) => s.label).join(', ')}.`,
            record: rec, href: href('deal', d.id), suggestedTask: { title: riskTask(signals, d.name), dueInDays: 1 },
          });
          const p75 = bigByCurrency.get(d.currency);
          if (p75 !== undefined && Number(d.amount) >= p75 && Number(d.amount) > 0) {
            push({
              key: `escalate_deal:${d.id}:${ymd(h.computedAt)}`, kind: 'escalate_deal', priority: NEXT_ACTION_RULES.escalate_deal.base + Math.round((100 - h.health) / 10),
              title: `Review ${d.name} with your manager`,
              reason: `High risk (health ${h.health}/100) and one of the largest open deals in ${d.currency}. A second view can save it.`,
              record: rec, href: href('deal', d.id), suggestedTask: { title: `Review ${d.name} with your manager`, dueInDays: 1 },
            });
          }
        }
        if (d.expectedCloseDate && ymd(d.expectedCloseDate) < today) {
          push({
            key: `close_date_passed:${d.id}:${ymd(d.expectedCloseDate)}`, kind: 'close_date_passed', priority: NEXT_ACTION_RULES.close_date_passed.base,
            title: `Confirm a new close date for ${d.name}`, reason: `It was expected to close on ${ymd(d.expectedCloseDate)}.`,
            record: rec, href: href('deal', d.id), suggestedTask: { title: `Confirm a new close date for ${d.name}`, dueInDays: 1 },
          });
        }
        if (d._count.tasks === 0) {
          push({
            key: `deal_no_next_step:${d.id}`, kind: 'deal_no_next_step', priority: NEXT_ACTION_RULES.deal_no_next_step.base,
            title: `Plan the next step for ${d.name}`, reason: 'No open task is scheduled on this deal.',
            record: rec, href: href('deal', d.id), suggestedTask: { title: `Plan the next step for ${d.name}`, dueInDays: 2 },
          });
        }
      }

      if (can('ai:use') && deals.length > 0) {
        const recs = await tx.aiRecommendation.findMany({
          where: { tenantId: t, kind: 'deal_health', status: 'PROPOSED', entityType: 'deal', entityId: { in: deals.map((d) => d.id) }, createdAt: { gte: new Date(now.getTime() - 14 * DAY) } },
          orderBy: { createdAt: 'desc' },
        });
        const byDeal = new Map(deals.map((d) => [d.id, d.name]));
        const done = new Set<string>();
        for (const r of recs) {
          if (done.has(r.entityId)) continue;
          done.add(r.entityId);
          const next = (r.payload as unknown as DealHealth).nextStep;
          if (!next) continue;
          const name = byDeal.get(r.entityId)!;
          push({
            key: `ai:${r.id}`, kind: 'ai_recommendation', priority: NEXT_ACTION_RULES.ai_recommendation.base,
            title: next.title, reason: `Deal Intelligence suggested this on ${ymd(r.createdAt)}: ${next.reason}`,
            record: { type: 'deal', id: r.entityId, name }, href: href('deal', r.entityId), suggestedTask: { title: next.title, dueInDays: next.dueInDays },
            recommendationId: r.id,
          });
        }
      }
    }

    if (can('quotes:read')) {
      const quotes = await tx.quote.findMany({
        where: { tenantId: t, isLatest: true, status: 'SENT', sentAt: { lt: new Date(now.getTime() - 5 * DAY) }, ...(f ? { opportunityId: { in: f.dealIds } } : { OR: [{ createdById: me }, { opportunity: { ownerId: me } }] }) },
        select: { id: true, number: true, version: true, sentAt: true, opportunity: { select: { name: true } } },
        take: 50,
      });
      for (const q of quotes) {
        const ref = formatReference('Q', q.number, q.version);
        push({
          key: `quote_awaiting_answer:${q.id}`, kind: 'quote_awaiting_answer', priority: NEXT_ACTION_RULES.quote_awaiting_answer.base,
          title: `Follow up on quote ${ref}`, reason: `Sent to ${q.opportunity.name} on ${ymd(q.sentAt!)}, ${daysSince(q.sentAt!, now)} days ago, with no answer recorded.`,
          record: { type: 'quote', id: q.id, name: ref }, href: href('quote', q.id), suggestedTask: { title: `Follow up on quote ${ref}`, dueInDays: 0 },
        });
      }
    }

    if (can('contracts:read')) {
      const ending = await tx.contract.findMany({
        where: { tenantId: t, ...(f ? { OR: [{ companyId: { in: f.companyIds } }, { opportunityId: { in: f.dealIds } }] } : { ownerId: me }), status: 'ACTIVE', endDate: { gte: new Date(`${ymd(now)}T00:00:00Z`), lte: new Date(now.getTime() + 30 * DAY) }, renewal: { is: null } },
        select: { id: true, number: true, name: true, endDate: true },
        take: 50,
      });
      for (const c of ending) {
        const ref = formatReference('C', c.number);
        push({
          key: `renewal_due:${c.id}:${ymd(c.endDate!)}`, kind: 'renewal_due', priority: NEXT_ACTION_RULES.renewal_due.base,
          title: `Start the renewal of ${ref} ${c.name}`, reason: `Ends on ${ymd(c.endDate!)} and no renewal is linked yet.`,
          record: { type: 'contract', id: c.id, name: `${ref} ${c.name}` }, href: href('contract', c.id), suggestedTask: { title: `Start the renewal of ${ref} ${c.name}`, dueInDays: 2 },
        });
      }
    }

    if (can('leads:read')) {
      const leads = await tx.lead.findMany({
        where: { tenantId: t, deletedAt: null, ...(f ? { id: { in: f.leadIds } } : { ownerId: me }), status: 'NEW', createdAt: { lt: new Date(now.getTime() - DAY), gte: new Date(now.getTime() - 30 * DAY) }, activities: { none: { deletedAt: null } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, fullName: true, companyName: true, createdAt: true },
        take: 50,
      });
      for (const l of leads) {
        push({
          key: `new_lead_untouched:${l.id}`, kind: 'new_lead_untouched', priority: NEXT_ACTION_RULES.new_lead_untouched.base,
          title: `Make first contact with ${l.fullName}${l.companyName ? ` (${l.companyName})` : ''}`, reason: `Added ${ymd(l.createdAt)}; still New with nothing logged.`,
          record: { type: 'lead', id: l.id, name: l.fullName }, href: href('lead', l.id), suggestedTask: { title: `Make first contact with ${l.fullName}`, dueInDays: 0 },
        });
      }
    }
    if (can('sequences:read')) {
      // Finished a sequence without replying: suggest a different channel instead of more email.
      const silent = await tx.sequenceEnrollment.findMany({
        where: {
          tenantId: t, status: 'COMPLETED', repliedAt: null, finishedAt: { gte: new Date(now.getTime() - 14 * DAY) },
          ...(f ? { OR: [{ leadId: { in: f.leadIds } }, { contactId: { in: f.contactIds } }] } : { senderId: me }),
        },
        select: { id: true, leadId: true, contactId: true, finishedAt: true, sequence: { select: { name: true } } },
        take: 50,
      });
      const [silentContacts, silentLeads] = await Promise.all([
        tx.contact.findMany({ where: { tenantId: t, deletedAt: null, id: { in: silent.flatMap((e) => (e.contactId ? [e.contactId] : [])) } }, select: { id: true, firstName: true, lastName: true, phone: true } }),
        tx.lead.findMany({ where: { tenantId: t, deletedAt: null, id: { in: silent.flatMap((e) => (e.leadId ? [e.leadId] : [])) } }, select: { id: true, fullName: true, phone: true } }),
      ]);
      const people = new Map<string, { name: string; phone: string | null }>([
        ...silentContacts.map((c) => [c.id, { name: [c.firstName, c.lastName].filter(Boolean).join(' '), phone: c.phone }] as const),
        ...silentLeads.map((l) => [l.id, { name: l.fullName, phone: l.phone }] as const),
      ]);
      for (const e of silent) {
        const type: NextActionRecordType = e.contactId ? 'contact' : 'lead';
        const id = (e.contactId ?? e.leadId)!;
        const person = people.get(id);
        if (!person) continue;
        const { name, phone } = person;
        const title = phone ? `Call ${name} instead of emailing` : `Try ${name} on another channel`;
        push({
          key: `prospect_silent:${e.id}`, kind: 'prospect_silent', priority: NEXT_ACTION_RULES.prospect_silent.base,
          title, reason: `Finished "${e.sequence.name}" on ${ymd(e.finishedAt!)} without replying. More email is unlikely to help.`,
          record: { type, id, name }, href: href(type, id), suggestedTask: { title, dueInDays: 1 },
        });
      }
    }
    return out;
  }

  async dismiss(auth: AuthContext, input: NextActionDismissInput): Promise<{ ok: true }> {
    const item = (await this.list(auth, input.focus)).items.find((i) => i.key === input.key);
    if (!item) throw new BadRequestException({ code: 'NEXT_ACTION_GONE', message: 'This suggestion is no longer on the list. Refresh to see the current one.' });
    await this.decide(auth, item, input.days ? 'snoozed' : 'dismissed', input.days ? new Date(Date.now() + input.days * DAY) : null, null);
    return { ok: true };
  }

  private decide(auth: AuthContext, item: NextAction, decision: 'accepted' | 'dismissed' | 'snoozed', until: Date | null, taskId: string | null) {
    const data = { kind: item.kind, recordType: item.record.type, recordId: item.record.id, decision, until, taskId };
    return this.prisma.run(auth, (tx) =>
      tx.nextActionDecision.upsert({
        where: { tenantId_userId_key: { tenantId: auth.tenantId, userId: auth.userId, key: item.key } },
        create: { tenantId: auth.tenantId, userId: auth.userId, key: item.key, ...data },
        update: data,
      }),
    );
  }

  /** Creates the suggested task (edited by the person) on the item's record, then hides the item. */
  async accept(auth: AuthContext, input: NextActionAcceptInput, meta: RequestMeta): Promise<{ taskId: string }> {
    const item = (await this.list(auth, input.focus)).items.find((i) => i.key === input.key);
    if (!item || !item.suggestedTask) {
      throw new BadRequestException({ code: 'NEXT_ACTION_GONE', message: 'This suggestion is no longer on your list. Refresh to see the current one.' });
    }
    const ref =
      item.record.type === 'deal' ? { opportunityId: item.record.id }
      : item.record.type === 'lead' ? { leadId: item.record.id }
      : item.record.type === 'contact' ? { contactId: item.record.id }
      : item.record.type === 'quote' || item.record.type === 'contract' ? await this.dealOf(auth, item.record.type, item.record.id)
      : {};
    const task = await this.tasks.create(auth, {
      title: input.title, description: `From your next best actions: ${item.reason}`, assigneeId: auth.userId,
      dueAt: new Date(Date.now() + input.dueInDays * DAY).toISOString(), ...ref,
    }, meta);
    await this.decide(auth, item, 'accepted', null, task.id);
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'next_action.accepted', entityType: item.record.type, entityId: item.record.id, metadata: { kind: item.kind, taskId: task.id }, meta }),
    );
    return { taskId: task.id };
  }

  /** Quotes and contracts hang their tasks on the deal (or company contact) they belong to. */
  private dealOf(auth: AuthContext, type: 'quote' | 'contract', id: string): Promise<{ opportunityId?: string }> {
    return this.prisma.run(auth, async (tx) => {
      const row = type === 'quote'
        ? await tx.quote.findFirst({ where: { id, tenantId: auth.tenantId }, select: { opportunityId: true } })
        : await tx.contract.findFirst({ where: { id, tenantId: auth.tenantId }, select: { opportunityId: true } });
      return row?.opportunityId ? { opportunityId: row.opportunityId } : {};
    });
  }
}
