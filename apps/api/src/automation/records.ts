import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../common/auth-context';
import { Prisma } from '@dealflow/database';
import { PrismaService } from '../common/prisma.service';
import { toActivityRow } from '../crm/activities.service';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { ownerRefs } from '../crm/crm-helpers';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';
import { toTaskRow } from '../crm/tasks.service';

export type RecordEntity = 'lead' | 'contact' | 'company' | 'deal' | 'task' | 'activity';

/**
 * Loads the record an automation is about, in the same shape the API returns, so conditions use the
 * field names people see in the app. Returns null when the record was deleted.
 */
@Injectable()
export class AutomationRecords {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly deals: DealsService,
  ) {}

  async load(auth: Pick<AuthContext, 'tenantId' | 'userId'>, entity: string | null, id: string | null, opts: { since?: string } = {}): Promise<Record<string, unknown> | null> {
    if (!entity || !id) return null;
    const a = auth as AuthContext;
    try {
      switch (entity as RecordEntity) {
        case 'lead':
          return { ...(await this.leads.get(a, id)), emailActivity: await this.emailActivity(auth.tenantId, 'lead', id, opts.since) };
        case 'contact':
          return { ...(await this.contacts.get(a, id)), emailActivity: await this.emailActivity(auth.tenantId, 'contact', id, opts.since) };
        case 'company':
          return { ...(await this.companies.get(a, id)) };
        case 'deal':
          return { ...(await this.deals.get(a, id)) };
        case 'task':
          return this.prisma.run(auth, async (tx) => {
            const row = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
            return row ? { ...toTaskRow(row, await ownerRefs(tx, [row.assigneeId]), new Date()) } : null;
          });
        case 'activity':
          return this.prisma.run(auth, async (tx) => {
            const row = await tx.activity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
            return row ? { ...toActivityRow(row, await ownerRefs(tx, [row.ownerId])) } : null;
          });
        default:
          return null;
      }
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  private emailActivity(tenantId: string, type: 'lead' | 'contact', id: string, since?: string): Promise<EmailActivity> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const who = type === 'lead' ? { leadId: id } : { contactId: id };
      const from = since ? new Date(since) : new Date();
      const month = new Date(Date.now() - 30 * 86_400_000);
      const [sent, lastInbound, active, inboundSince] = await Promise.all([
        tx.sequenceMessage.findMany({ where: { tenantId, enrollment: who }, select: { sentAt: true, repliedAt: true, openedAt: true, clickedAt: true } }),
        tx.emailMessage.findFirst({ where: { tenantId, ...who, direction: 'INBOUND' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
        tx.sequenceEnrollment.count({ where: { tenantId, ...who, status: { in: ['ACTIVE', 'PAUSED'] } } }),
        tx.emailMessage.count({ where: { tenantId, ...who, direction: 'INBOUND', sentAt: { gt: from } } }),
      ]);
      const latest = (ds: Array<Date | null | undefined>): Date | null => ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
      const recent = (d: Date | null) => !!d && d > month;
      const r = {
        last_sent: latest(sent.map((m) => m.sentAt)),
        last_reply: latest([...sent.map((m) => m.repliedAt), lastInbound?.sentAt]),
        last_open: latest(sent.map((m) => m.openedAt)),
        last_click: latest(sent.map((m) => m.clickedAt)),
        opens30: sent.filter((m) => recent(m.openedAt)).length,
        clicks30: sent.filter((m) => recent(m.clickedAt)).length,
        replies30: sent.filter((m) => recent(m.repliedAt)).length,
        active,
        inbound_since: inboundSince,
      };
      const after = (d: Date | null) => !!d && d > from;
      return {
        lastSentAt: r.last_sent?.toISOString() ?? null,
        lastReplyAt: r.last_reply?.toISOString() ?? null,
        lastOpenAt: r.last_open?.toISOString() ?? null,
        lastClickAt: r.last_click?.toISOString() ?? null,
        opens30: r.opens30,
        clicks30: r.clicks30,
        replies30: r.replies30,
        activeSequences: r.active,
        repliedSinceTrigger: after(r.last_reply) || r.inbound_since > 0,
        openedSinceTrigger: after(r.last_open),
        clickedSinceTrigger: after(r.last_click),
      };
    });
  }
}

/**
 * What a lead or contact has done with our email, for conditions such as "replied since the trigger" or
 * "clicked at least twice in 30 days". Opens are estimates; replies and bounces are confirmed.
 */
export interface EmailActivity {
  lastSentAt: string | null;
  lastReplyAt: string | null;
  lastOpenAt: string | null;
  lastClickAt: string | null;
  opens30: number;
  clicks30: number;
  replies30: number;
  activeSequences: number;
  repliedSinceTrigger: boolean;
  openedSinceTrigger: boolean;
  clickedSinceTrigger: boolean;
}

export function relatedLinks(entity: string | null, id: string | null, record: Record<string, unknown> | null) {
  const pick = (k: string) => (record && typeof record[k] === 'string' ? (record[k] as string) : undefined);
  switch (entity) {
    case 'lead':
      return { leadId: id ?? undefined };
    case 'contact':
      return { contactId: id ?? undefined };
    case 'deal': {
      const contact = record?.contact as { id?: string } | null | undefined;
      return { opportunityId: id ?? undefined, contactId: contact?.id };
    }
    case 'company':
      return { companyId: id ?? undefined };
    case 'task':
    case 'activity':
      return { leadId: pick('leadId'), contactId: pick('contactId'), opportunityId: pick('opportunityId') };
    default:
      return {};
  }
}

/** Replaces `{{record.field}}` / `{{event.field}}` placeholders in workflow text. */
export function renderTemplate(text: string, ctx: { record: Record<string, unknown> | null; event: Record<string, unknown> }): string {
  return text.replace(/\{\{\s*(record|event)\.([A-Za-z0-9_.]{1,80})\s*\}\}/g, (_, root: string, path: string) => {
    let cur: unknown = root === 'record' ? ctx.record : ctx.event;
    for (const k of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    return cur === null || cur === undefined ? '' : typeof cur === 'object' ? '' : String(cur);
  });
}
