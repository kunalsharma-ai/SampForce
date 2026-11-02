import { Injectable } from '@nestjs/common';
import type { Insight, InsightFeed, InsightScope } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { money as moneyIn, percent, tr } from '../common/request-language';

const DAY = 86_400_000;
/** Below this many sequence emails in a week, a reply rate says more about chance than about the emails. */
const MIN_SENDS_FOR_RATE = 20;

const money = (n: number, currency: string) => moneyIn(n, currency);
const pct = (n: number) => percent(Math.round(n * 1000) / 10);
/** Picks the singular or plural sentence, so each language can phrase both. */
const one = (n: number, singular: string, plural: string, vars: Record<string, string | number> = {}) => tr(n === 1 ? singular : plural, { n, ...vars });
const otherNote = (n: number) => (n ? ` ${tr('{n} in other currencies not included in the value.', { n })}` : '');

/**
 * Sales insights feed (enhancement spec feature 1). Counts and comparisons over the last seven days against the seven
 * before, each one computed from workspace records and linked to the records behind it. Copilot reads the same feed
 * (tool `sales_insights`) to write a briefing, so there is one source of numbers for people and for the AI.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  feed(auth: AuthContext, scope: InsightScope, now = new Date()): Promise<InsightFeed> {
    const can = (p: string) => auth.permissions.includes(p);
    return this.prisma.run(auth, async (tx) => {
      const t = auth.tenantId;
      const mine = scope === 'mine';
      const owner = mine ? { ownerId: auth.userId } : {};
      const weekAgo = new Date(now.getTime() - 7 * DAY);
      const twoWeeksAgo = new Date(now.getTime() - 14 * DAY);
      const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
      const { defaultCurrency: currency } = await tx.tenant.findUniqueOrThrow({ where: { id: t }, select: { defaultCurrency: true } });
      const items: Insight[] = [];

      if (can('deals:read')) {
        const openDeal = { tenantId: t, deletedAt: null, status: 'OPEN' as const, ...owner };
        const [high, newlyHigh, overdueClose, createdNow, createdBefore, wonNow, wonBefore] = await Promise.all([
          tx.dealHealthScore.count({ where: { tenantId: t, risk: 'high', deal: openDeal } }),
          tx.dealHealthScore.count({ where: { tenantId: t, risk: 'high', alertedAt: { gte: weekAgo }, deal: openDeal } }),
          tx.opportunity.count({ where: { ...openDeal, expectedCloseDate: { lt: today } } }),
          tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, ...owner, createdAt: { gte: weekAgo } }, select: { amount: true, currency: true } }),
          tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, ...owner, createdAt: { gte: twoWeeksAgo, lt: weekAgo } }, select: { amount: true, currency: true } }),
          tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, ...owner, status: 'WON', closedAt: { gte: weekAgo } }, select: { amount: true, currency: true } }),
          tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, ...owner, status: 'WON', closedAt: { gte: twoWeeksAgo, lt: weekAgo } }, select: { amount: true, currency: true } }),
        ]);
        const sum = (rows: { amount: unknown; currency: string }[]) => rows.filter((r) => r.currency === currency).reduce((a, r) => a + Number(r.amount), 0);
        const otherCurrencies = (rows: { currency: string }[]) => rows.filter((r) => r.currency !== currency).length;

        if (high > 0) {
          items.push({
            key: 'high_risk_deals', tone: 'attention',
            title: one(high, '{n} open deal is critical (high risk)', '{n} open deals are critical (high risk)'),
            detail: newlyHigh > 0 ? tr('{n} turned critical in the last 7 days. Health comes from activity, stage age, tasks and dates.', { n: newlyHigh }) : tr('None turned critical in the last 7 days.'),
            metric: { current: high, previous: null, unit: 'count' }, href: `/app/deals/health?risk=high${mine ? '&mine=true' : ''}`,
          });
        }
        if (overdueClose > 0) {
          items.push({
            key: 'close_date_passed', tone: 'attention', title: one(overdueClose, '{n} open deal has a close date in the past', '{n} open deals have a close date in the past'),
            detail: tr('Update the date or the stage so the forecast stays honest.'), metric: { current: overdueClose, previous: null, unit: 'count' }, href: '/app/deals',
          });
        }
        const other = otherCurrencies(createdNow);
        items.push({
          key: 'pipeline_created', tone: createdNow.length >= createdBefore.length ? 'good' : 'info',
          title: one(createdNow.length, '{n} new deal worth {value}', '{n} new deals worth {value}', { value: money(sum(createdNow), currency) }),
          detail: `${tr('{n} the week before ({value}).', { n: createdBefore.length, value: money(sum(createdBefore), currency) })}${otherNote(other)}`,
          metric: { current: sum(createdNow), previous: sum(createdBefore), unit: 'money' }, href: '/app/deals',
        });
        if (wonNow.length || wonBefore.length) {
          items.push({
            key: 'deals_won', tone: wonNow.length ? 'good' : 'info', title: one(wonNow.length, '{n} deal won, {value}', '{n} deals won, {value}', { value: money(sum(wonNow), currency) }),
            detail: `${tr('{n} the week before ({value}).', { n: wonBefore.length, value: money(sum(wonBefore), currency) })}${otherNote(otherCurrencies(wonNow))}`,
            metric: { current: sum(wonNow), previous: sum(wonBefore), unit: 'money' }, href: '/app/revenue',
          });
        }
      }

      if (can('activities:read')) {
        const mailbox = mine ? { connection: { userId: auth.userId } } : {};
        const known = { OR: [{ contactId: { not: null } }, { leadId: { not: null } }] };
        const [repliesNow, repliesBefore, overdue] = await Promise.all([
          tx.emailMessage.count({ where: { tenantId: t, direction: 'INBOUND', sentAt: { gte: weekAgo }, ...mailbox, ...known } }),
          tx.emailMessage.count({ where: { tenantId: t, direction: 'INBOUND', sentAt: { gte: twoWeeksAgo, lt: weekAgo }, ...mailbox, ...known } }),
          tx.task.count({ where: { tenantId: t, deletedAt: null, status: 'OPEN', dueAt: { lt: now }, ...(mine ? { assigneeId: auth.userId } : {}) } }),
        ]);
        if (repliesNow || repliesBefore) {
          items.push({
            key: 'emails_received', tone: 'info', title: one(repliesNow, '{n} email from leads and contacts', '{n} emails from leads and contacts'),
            detail: tr('{n} the week before. Counts mail synced from connected mailboxes only.', { n: repliesBefore }), metric: { current: repliesNow, previous: repliesBefore, unit: 'count' }, href: '/app/communication',
          });
        }
        if (overdue) {
          items.push({ key: 'overdue_tasks', tone: 'attention', title: one(overdue, '{n} overdue task', '{n} overdue tasks'), detail: mine ? tr('Assigned to you.') : tr('Across the team.'), metric: { current: overdue, previous: null, unit: 'count' }, href: '/app/activities?tab=tasks' });
        }
      }

      if (can('leads:read')) {
        const untouched = await tx.lead.count({ where: { tenantId: t, deletedAt: null, ...owner, status: 'NEW', createdAt: { lt: new Date(now.getTime() - DAY) }, activities: { none: { deletedAt: null } } } });
        if (untouched) {
          items.push({ key: 'untouched_leads', tone: 'attention', title: one(untouched, '{n} new lead with no contact yet', '{n} new leads with no contact yet'), detail: tr('Still New, nothing logged, added more than a day ago.'), metric: { current: untouched, previous: null, unit: 'count' }, href: '/app/leads?status=NEW' });
        }
      }

      if (can('sequences:read')) {
        const sender = mine ? { senderId: auth.userId } : {};
        const [sentNow, repliedNow, sentBefore, repliedBefore] = await Promise.all([
          tx.sequenceMessage.count({ where: { tenantId: t, ...sender, sentAt: { gte: weekAgo } } }),
          tx.sequenceMessage.count({ where: { tenantId: t, ...sender, sentAt: { gte: weekAgo }, repliedAt: { not: null } } }),
          tx.sequenceMessage.count({ where: { tenantId: t, ...sender, sentAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
          tx.sequenceMessage.count({ where: { tenantId: t, ...sender, sentAt: { gte: twoWeeksAgo, lt: weekAgo }, repliedAt: { not: null } } }),
        ]);
        if (sentNow >= MIN_SENDS_FOR_RATE) {
          const now7 = repliedNow / sentNow;
          const before7 = sentBefore >= MIN_SENDS_FOR_RATE ? repliedBefore / sentBefore : null;
          items.push({
            key: 'sequence_reply_rate', tone: before7 !== null && now7 < before7 ? 'attention' : 'info',
            title: tr('Sequence reply rate {rate} ({replied} of {sent})', { rate: pct(now7), replied: repliedNow, sent: sentNow }),
            detail: before7 === null ? tr('Too few sends the week before to compare.') : tr('{rate} the week before ({replied} of {sent}). Replies so far; later replies still count toward the week sent.', { rate: pct(before7), replied: repliedBefore, sent: sentBefore }),
            metric: { current: now7 * 100, previous: before7 === null ? null : before7 * 100, unit: 'percent' }, href: '/app/sequences',
          });
        } else if (sentNow > 0) {
          items.push({ key: 'sequence_reply_rate', tone: 'info', title: one(sentNow, '{n} sequence email sent, {replied} replied', '{n} sequence emails sent, {replied} replied', { replied: repliedNow }), detail: tr('A reply rate is shown from {n} sends a week.', { n: MIN_SENDS_FOR_RATE }), metric: null, href: '/app/sequences' });
        }
      }

      if (can('contracts:read')) {
        const renewals = await tx.contract.count({ where: { tenantId: t, ...owner, status: 'ACTIVE', endDate: { gte: today, lte: new Date(now.getTime() + 30 * DAY) }, renewal: { is: null } } });
        if (renewals) items.push({ key: 'renewals_due', tone: 'attention', title: one(renewals, '{n} contract ends within 30 days', '{n} contracts end within 30 days'), detail: tr('No renewal is linked yet.'), metric: { current: renewals, previous: null, unit: 'count' }, href: '/app/contracts' });
      }

      if (can('success:read')) {
        const atRisk = await tx.companyHealth.count({ where: { tenantId: t, band: 'at_risk', ...(mine ? { company: { ownerId: auth.userId } } : {}) } });
        if (atRisk) items.push({ key: 'customers_at_risk', tone: 'attention', title: one(atRisk, '{n} customer at risk', '{n} customers at risk'), detail: tr('From customer health: activity, escalations, renewal window and overdue tasks.'), metric: { current: atRisk, previous: null, unit: 'count' }, href: '/app/customer-success' });
      }

      const order = { attention: 0, good: 1, info: 2 } as const;
      items.sort((a, b) => order[a.tone] - order[b.tone]);
      return { scope, periodStart: weekAgo.toISOString(), currency, items, generatedAt: now.toISOString() };
    });
  }
}
