import { Injectable } from '@nestjs/common';
import type { Insight, InsightFeed, InsightScope } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';

const DAY = 86_400_000;
/** Below this many sequence emails in a week, a reply rate says more about chance than about the emails. */
const MIN_SENDS_FOR_RATE = 20;

const money = (n: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

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
            title: `${high} open deal${high === 1 ? ' is' : 's are'} at high risk`,
            detail: newlyHigh > 0 ? `${newlyHigh} turned high risk in the last 7 days. Health comes from activity, stage age, tasks and dates.` : 'None turned high risk in the last 7 days.',
            metric: { current: high, previous: null, unit: 'count' }, href: `/app/deals/health?risk=high${mine ? '&mine=true' : ''}`,
          });
        }
        if (overdueClose > 0) {
          items.push({
            key: 'close_date_passed', tone: 'attention', title: `${overdueClose} open deal${overdueClose === 1 ? ' has' : 's have'} a close date in the past`,
            detail: 'Update the date or the stage so the forecast stays honest.', metric: { current: overdueClose, previous: null, unit: 'count' }, href: '/app/deals',
          });
        }
        const other = otherCurrencies(createdNow);
        items.push({
          key: 'pipeline_created', tone: createdNow.length >= createdBefore.length ? 'good' : 'info',
          title: `${createdNow.length} new deal${createdNow.length === 1 ? '' : 's'} worth ${money(sum(createdNow), currency)}`,
          detail: `${createdBefore.length} the week before (${money(sum(createdBefore), currency)}).${other ? ` ${other} in other currencies not included in the value.` : ''}`,
          metric: { current: sum(createdNow), previous: sum(createdBefore), unit: 'money' }, href: '/app/deals',
        });
        if (wonNow.length || wonBefore.length) {
          items.push({
            key: 'deals_won', tone: wonNow.length ? 'good' : 'info', title: `${wonNow.length} deal${wonNow.length === 1 ? '' : 's'} won, ${money(sum(wonNow), currency)}`,
            detail: `${wonBefore.length} the week before (${money(sum(wonBefore), currency)}).${otherCurrencies(wonNow) ? ` ${otherCurrencies(wonNow)} in other currencies not included in the value.` : ''}`,
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
            key: 'emails_received', tone: 'info', title: `${repliesNow} email${repliesNow === 1 ? '' : 's'} from leads and contacts`,
            detail: `${repliesBefore} the week before. Counts mail synced from connected mailboxes only.`, metric: { current: repliesNow, previous: repliesBefore, unit: 'count' }, href: '/app/communication',
          });
        }
        if (overdue) {
          items.push({ key: 'overdue_tasks', tone: 'attention', title: `${overdue} overdue task${overdue === 1 ? '' : 's'}`, detail: mine ? 'Assigned to you.' : 'Across the team.', metric: { current: overdue, previous: null, unit: 'count' }, href: '/app/activities?tab=tasks' });
        }
      }

      if (can('leads:read')) {
        const untouched = await tx.lead.count({ where: { tenantId: t, deletedAt: null, ...owner, status: 'NEW', createdAt: { lt: new Date(now.getTime() - DAY) }, activities: { none: { deletedAt: null } } } });
        if (untouched) {
          items.push({ key: 'untouched_leads', tone: 'attention', title: `${untouched} new lead${untouched === 1 ? '' : 's'} with no contact yet`, detail: 'Still New, nothing logged, added more than a day ago.', metric: { current: untouched, previous: null, unit: 'count' }, href: '/app/leads?status=NEW' });
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
            title: `Sequence reply rate ${pct(now7)} (${repliedNow} of ${sentNow})`,
            detail: before7 === null ? 'Too few sends the week before to compare.' : `${pct(before7)} the week before (${repliedBefore} of ${sentBefore}). Replies so far; later replies still count toward the week sent.`,
            metric: { current: now7 * 100, previous: before7 === null ? null : before7 * 100, unit: 'percent' }, href: '/app/sequences',
          });
        } else if (sentNow > 0) {
          items.push({ key: 'sequence_reply_rate', tone: 'info', title: `${sentNow} sequence email${sentNow === 1 ? '' : 's'} sent, ${repliedNow} replied`, detail: `A reply rate is shown from ${MIN_SENDS_FOR_RATE} sends a week.`, metric: null, href: '/app/sequences' });
        }
      }

      if (can('contracts:read')) {
        const renewals = await tx.contract.count({ where: { tenantId: t, ...owner, status: 'ACTIVE', endDate: { gte: today, lte: new Date(now.getTime() + 30 * DAY) }, renewal: { is: null } } });
        if (renewals) items.push({ key: 'renewals_due', tone: 'attention', title: `${renewals} contract${renewals === 1 ? '' : 's'} end${renewals === 1 ? 's' : ''} within 30 days`, detail: 'No renewal is linked yet.', metric: { current: renewals, previous: null, unit: 'count' }, href: '/app/contracts' });
      }

      if (can('success:read')) {
        const atRisk = await tx.companyHealth.count({ where: { tenantId: t, band: 'at_risk', ...(mine ? { company: { ownerId: auth.userId } } : {}) } });
        if (atRisk) items.push({ key: 'customers_at_risk', tone: 'attention', title: `${atRisk} customer${atRisk === 1 ? '' : 's'} at risk`, detail: 'From customer health: activity, escalations, renewal window and overdue tasks.', metric: { current: atRisk, previous: null, unit: 'count' }, href: '/app/customer-success' });
      }

      const order = { attention: 0, good: 1, info: 2 } as const;
      items.sort((a, b) => order[a.tone] - order[b.tone]);
      return { scope, periodStart: weekAgo.toISOString(), currency, items, generatedAt: now.toISOString() };
    });
  }
}
