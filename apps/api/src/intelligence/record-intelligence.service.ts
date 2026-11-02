import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { BuyingSignal, DecisionMaker, RecordIntelligence, TimelineEntity } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { localize, tr } from '../common/request-language';
import { notFound } from '../crm/crm-helpers';

const DAY = 86_400_000;
/** Job titles that usually sign off or sponsor a purchase. A heuristic over the title text, shown as such. */
export const SENIOR_TITLE = /\b(chief|ceo|cfo|cto|coo|cmo|cio|cro|founder|co-founder|owner|president|partner|managing director|md|director|head of|vp|vice president|general manager)\b/i;

interface People {
  leadIds: string[];
  contactIds: string[];
  dealIds: string[];
  companyId: string | null;
}

/**
 * AI sales intelligence on each record (enhancement spec features 1 and 2): engagement trend, buying signals,
 * decision-makers, account value and cross-sell ideas, all computed from workspace records. The written summary comes
 * from Copilot ("Summarise this relationship"), which reads the same records, so there is one AI layer.
 */
@Injectable()
export class RecordIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  get(auth: AuthContext, entity: TimelineEntity, id: string, now = new Date()): Promise<RecordIntelligence> {
    const can = (p: string) => auth.permissions.includes(p);
    return this.prisma.run(auth, async (tx) => {
      const t = auth.tenantId;
      const p = await this.people(tx, t, entity, id);
      const personOr = [
        ...(p.leadIds.length ? [{ leadId: { in: p.leadIds } }] : []),
        ...(p.contactIds.length ? [{ contactId: { in: p.contactIds } }] : []),
      ];
      const activityOr = [...personOr, ...(p.dealIds.length ? [{ opportunityId: { in: p.dealIds } }] : []), ...(entity === 'company' ? [{ companyId: id }] : [])];
      const d30 = new Date(now.getTime() - 30 * DAY);
      const d60 = new Date(now.getTime() - 60 * DAY);

      // Engagement: logged activity plus email both ways.
      let last30 = 0;
      let previous30 = 0;
      let lastInbound: Date | null = null;
      let lastOutbound: Date | null = null;
      if (can('activities:read') && activityOr.length) {
        const [a30, a60, e30, e60, inb, outb] = await Promise.all([
          tx.activity.count({ where: { tenantId: t, deletedAt: null, occurredAt: { gte: d30 }, OR: activityOr } }),
          tx.activity.count({ where: { tenantId: t, deletedAt: null, occurredAt: { gte: d60, lt: d30 }, OR: activityOr } }),
          personOr.length ? tx.emailMessage.count({ where: { tenantId: t, sentAt: { gte: d30 }, OR: personOr } }) : 0,
          personOr.length ? tx.emailMessage.count({ where: { tenantId: t, sentAt: { gte: d60, lt: d30 }, OR: personOr } }) : 0,
          personOr.length ? tx.emailMessage.findFirst({ where: { tenantId: t, direction: 'INBOUND', OR: personOr }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }) : null,
          personOr.length ? tx.emailMessage.findFirst({ where: { tenantId: t, direction: 'OUTBOUND', OR: personOr }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }) : null,
        ]);
        last30 = a30 + e30;
        previous30 = a60 + e60;
        lastInbound = inb?.sentAt ?? null;
        lastOutbound = outb?.sentAt ?? null;
      }
      const trend: RecordIntelligence['engagement']['trend'] =
        last30 === 0 && previous30 === 0 ? 'none' : previous30 >= 3 && last30 * 2 <= previous30 ? 'declining' : last30 > previous30 * 1.5 && last30 >= 3 ? 'rising' : 'steady';

      // Buying signals.
      const signals: BuyingSignal[] = [];
      if (can('activities:read') && personOr.length) {
        const replies = await tx.emailMessage.findMany({ where: { tenantId: t, direction: 'INBOUND', sentAt: { gte: d30 }, OR: personOr }, orderBy: { sentAt: 'desc' }, take: 3, select: { id: true, subject: true, sentAt: true, fromAddress: true } });
        for (const r of replies) signals.push({ key: `reply:${r.id}`, label: tr('Wrote to you'), detail: `${r.fromAddress}: "${r.subject || tr('(no subject)')}"`, at: r.sentAt.toISOString(), confirmed: true });
        if (p.contactIds.length) {
          const upcoming = await tx.meeting.findFirst({ where: { tenantId: t, canceled: false, startsAt: { gte: now }, contactIds: { hasSome: p.contactIds } }, orderBy: { startsAt: 'asc' }, select: { title: true, startsAt: true } });
          if (upcoming) signals.push({ key: 'meeting_booked', label: tr('Meeting booked'), detail: upcoming.title, at: upcoming.startsAt.toISOString(), confirmed: true });
        }
      }
      if (can('sequences:read') && personOr.length) {
        const events = await tx.emailEvent.findMany({
          where: { tenantId: t, type: { in: ['CLICKED', 'OPENED'] }, createdAt: { gte: d30 }, message: { enrollment: { OR: personOr } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { type: true, url: true, createdAt: true, messageId: true },
        });
        const clicks = events.filter((e) => e.type === 'CLICKED');
        if (clicks[0]) signals.push({ key: 'clicked', label: clicks.length === 1 ? tr('Clicked a link in your emails') : tr('Clicked {n} links in your emails', { n: clicks.length }), detail: clicks[0].url ?? '', at: clicks[0].createdAt.toISOString(), confirmed: true });
        const openedMessages = new Set(events.filter((e) => e.type === 'OPENED').map((e) => e.messageId));
        if (openedMessages.size >= 2) {
          const first = events.find((e) => e.type === 'OPENED')!;
          signals.push({ key: 'opened_several', label: tr('Opened {n} of your emails (estimate)', { n: openedMessages.size }), detail: tr('Opens are approximate: privacy features and scanners can load images.'), at: first.createdAt.toISOString(), confirmed: false });
        }
      }
      if (can('marketing:read') && p.leadIds.length) {
        const form = await tx.formSubmission.findFirst({ where: { tenantId: t, leadId: { in: p.leadIds }, createdAt: { gte: new Date(now.getTime() - 90 * DAY) } }, orderBy: { createdAt: 'desc' }, include: { form: { select: { name: true } } } });
        if (form) signals.push({ key: 'form', label: tr('Filled in a form'), detail: form.form.name, at: form.createdAt.toISOString(), confirmed: true });
      }
      if (can('deals:read') && p.dealIds.length) {
        const moved = await tx.dealStageEvent.findFirst({ where: { tenantId: t, opportunityId: { in: p.dealIds }, fromStageId: { not: null }, occurredAt: { gte: new Date(now.getTime() - 14 * DAY) } }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true, toStageId: true, opportunity: { select: { name: true } } } });
        if (moved) {
          const stage = await tx.pipelineStage.findUnique({ where: { id: moved.toStageId }, select: { name: true } });
          signals.push({ key: 'stage_moved', label: tr('Deal moved forward'), detail: stage ? tr('{deal} to {stage}', { deal: moved.opportunity.name, stage: localize(stage.name) }) : tr('{deal} to a new stage', { deal: moved.opportunity.name }), at: moved.occurredAt.toISOString(), confirmed: true });
        }
      }
      if (can('quotes:read') && p.dealIds.length) {
        const q = await tx.quote.findFirst({ where: { tenantId: t, opportunityId: { in: p.dealIds }, status: 'ACCEPTED', decidedAt: { gte: d60 } }, orderBy: { decidedAt: 'desc' }, select: { decidedAt: true, title: true } });
        if (q) signals.push({ key: 'quote_accepted', label: tr('Accepted a quote'), detail: q.title, at: q.decidedAt!.toISOString(), confirmed: true });
      }
      signals.sort((a, b) => b.at.localeCompare(a.at));

      // Decision-makers at the company.
      let decisionMakers: DecisionMaker[] | null = null;
      if (p.companyId && can('contacts:read')) {
        const contacts = await tx.contact.findMany({ where: { tenantId: t, companyId: p.companyId, deletedAt: null, jobTitle: { not: null } }, select: { id: true, firstName: true, lastName: true, jobTitle: true }, take: 300 });
        const senior = contacts.filter((c) => SENIOR_TITLE.test(c.jobTitle ?? '')).slice(0, 10);
        decisionMakers = await Promise.all(
          senior.map(async (c) => {
            const [a, m] = await Promise.all([
              tx.activity.findFirst({ where: { tenantId: t, deletedAt: null, contactId: c.id }, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
              tx.emailMessage.findFirst({ where: { tenantId: t, contactId: c.id }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
            ]);
            const last = [a?.occurredAt, m?.sentAt].filter((x): x is Date => !!x).sort((x, y) => y.getTime() - x.getTime())[0];
            return { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' '), jobTitle: c.jobTitle!, lastEngagedAt: last?.toISOString() ?? null };
          }),
        );
      }

      // Account value and cross-sell.
      let account: RecordIntelligence['account'] = null;
      if (p.companyId && can('deals:read')) {
        const company = await tx.company.findFirst({ where: { id: p.companyId, tenantId: t }, select: { id: true, name: true } });
        const { defaultCurrency: currency } = await tx.tenant.findUniqueOrThrow({ where: { id: t }, select: { defaultCurrency: true } });
        const deals = await tx.opportunity.findMany({ where: { tenantId: t, companyId: p.companyId, deletedAt: null, status: { in: ['WON', 'OPEN'] } }, select: { status: true, amount: true, currency: true, closedAt: true } });
        const contracts = can('contracts:read') ? await tx.contract.findMany({ where: { tenantId: t, companyId: p.companyId, status: 'ACTIVE' }, select: { value: true, currency: true, endDate: true } }) : [];
        const same = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => r.currency === currency);
        const won = deals.filter((d) => d.status === 'WON');
        let notYetBought: string[] = [];
        if (won.length && can('quotes:read')) {
          const bought = await tx.quoteLine.findMany({ where: { tenantId: t, quote: { status: 'ACCEPTED', opportunity: { companyId: p.companyId } } }, select: { productId: true }, distinct: ['productId'] });
          notYetBought = (await tx.product.findMany({ where: { tenantId: t, active: true, id: { notIn: bought.map((b) => b.productId) } }, select: { name: true }, orderBy: { name: 'asc' }, take: 5 })).map((x) => x.name);
        }
        const firstWin = won.map((d) => d.closedAt).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0];
        account = {
          companyId: p.companyId,
          companyName: company?.name ?? '',
          currency,
          wonTotal: same(won).reduce((s, d) => s + Number(d.amount), 0),
          wonDeals: won.length,
          openPipeline: same(deals.filter((d) => d.status === 'OPEN')).reduce((s, d) => s + Number(d.amount), 0),
          activeContractValue: same(contracts).reduce((s, c) => s + Number(c.value), 0),
          otherCurrency: deals.filter((d) => d.currency !== currency).length + contracts.filter((c) => c.currency !== currency).length,
          customerSince: firstWin?.toISOString().slice(0, 10) ?? null,
          notYetBought,
          renewalWithin60Days: contracts.some((c) => c.endDate && c.endDate.getTime() - now.getTime() < 60 * DAY && c.endDate >= now),
        };
      }

      const flags: RecordIntelligence['flags'] = [];
      const lastTouch = [lastInbound, lastOutbound].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
      if (last30 === 0 && (previous30 > 0 || (lastTouch && lastTouch < d60))) flags.push({ key: 'inactive', label: tr('No contact in the last 30 days') });
      if (trend === 'declining') flags.push({ key: 'declining', label: tr('Engagement is falling') });
      if (signals.filter((s) => s.confirmed).length >= 2) flags.push({ key: 'high_intent', label: tr('Several buying signals recently') });
      if (decisionMakers && decisionMakers.length === 0 && entity !== 'lead') flags.push({ key: 'no_decision_maker', label: tr('No senior contact recorded at this company') });

      return {
        engagement: { last30, previous30, trend, lastInboundAt: lastInbound?.toISOString() ?? null, lastOutboundAt: lastOutbound?.toISOString() ?? null },
        buyingSignals: signals.slice(0, 8),
        decisionMakers,
        account,
        flags,
      };
    });
  }

  private async people(tx: TenantTx, t: string, entity: TimelineEntity, id: string): Promise<People> {
    if (entity === 'lead') {
      const l = await tx.lead.findFirst({ where: { id, tenantId: t, deletedAt: null }, select: { id: true } });
      if (!l) throw notFound('Lead');
      return { leadIds: [id], contactIds: [], dealIds: [], companyId: null };
    }
    if (entity === 'contact') {
      const c = await tx.contact.findFirst({ where: { id, tenantId: t, deletedAt: null }, select: { companyId: true } });
      if (!c) throw notFound('Contact');
      const [leads, deals] = await Promise.all([
        tx.lead.findMany({ where: { tenantId: t, convertedContactId: id }, select: { id: true } }),
        tx.opportunity.findMany({ where: { tenantId: t, contactId: id, deletedAt: null }, select: { id: true }, take: 200 }),
      ]);
      return { leadIds: leads.map((l) => l.id), contactIds: [id], dealIds: deals.map((d) => d.id), companyId: c.companyId };
    }
    if (entity === 'deal') {
      const d = await tx.opportunity.findFirst({ where: { id, tenantId: t, deletedAt: null }, select: { contactId: true, companyId: true } });
      if (!d) throw notFound('Deal');
      return { leadIds: [], contactIds: d.contactId ? [d.contactId] : [], dealIds: [id], companyId: d.companyId };
    }
    const co = await tx.company.findFirst({ where: { id, tenantId: t, deletedAt: null }, select: { id: true } });
    if (!co) throw notFound('Company');
    const [contacts, deals] = await Promise.all([
      tx.contact.findMany({ where: { tenantId: t, companyId: id, deletedAt: null }, select: { id: true }, take: 500 }),
      tx.opportunity.findMany({ where: { tenantId: t, companyId: id, deletedAt: null }, select: { id: true }, take: 500 }),
    ]);
    return { leadIds: [], contactIds: contacts.map((c) => c.id), dealIds: deals.map((d) => d.id), companyId: id };
  }
}
