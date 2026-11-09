import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { AnalyticsCounts, EmailAnalytics, EmailAnalyticsQuery, EmailInsight, SequenceStatus } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { seqSteps } from './sequences.service';
import { percentileCont } from '../common/stats';

type Row = { sequence_id: string; sender_id: string; step_id: string; variant: string; sent: number; replied: number; opened: number; clicked: number; bounced: number; unsubscribed: number };
type Counts = Omit<AnalyticsCounts, 'replyRate' | 'bounceRate'>;

const zero = (): Counts => ({ sent: 0, replied: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 });
const add = (a: Counts, r: Row) => {
  a.sent += r.sent;
  a.replied += r.replied;
  a.opened += r.opened;
  a.clicked += r.clicked;
  a.bounced += r.bounced;
  a.unsubscribed += r.unsubscribed;
};
const rates = (c: Counts): AnalyticsCounts => ({ ...c, replyRate: c.sent ? c.replied / c.sent : null, bounceRate: c.sent ? c.bounced / c.sent : null });

/**
 * Campaign analytics over sequence emails: per sequence, per sending mailbox, per template and per step position.
 * People see their own sends; marketing managers can see the team. Counts come from stored messages and events only.
 */
@Injectable()
export class EmailAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  analytics(auth: AuthContext, q: EmailAnalyticsQuery): Promise<EmailAnalytics> {
    if (q.scope === 'team' && !auth.permissions.includes('marketing:manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only people who manage marketing can see the whole team’s email results.' });
    }
    return this.prisma.run(auth, async (tx) => {
      const since = new Date(Date.now() - q.days * 86_400_000);
      const mine = q.scope === 'mine' ? auth.userId : null;
      const messages = await sentMessages(tx, auth.tenantId, since, mine);
      const grouped = new Map<string, Row>();
      for (const m of messages) {
        const k = `${m.enrollment.sequenceId}:${m.enrollment.senderId}:${m.stepId}:${m.variant}`;
        let r = grouped.get(k);
        if (!r) grouped.set(k, (r = { sequence_id: m.enrollment.sequenceId, sender_id: m.enrollment.senderId, step_id: m.stepId, variant: m.variant, sent: 0, replied: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 }));
        r.sent++;
        if (m.repliedAt) r.replied++;
        if (m.openedAt) r.opened++;
        if (m.clickedAt) r.clicked++;
        if (m.bouncedAt) r.bounced++;
        if (m.events.length) r.unsubscribed++;
      }
      const rows = [...grouped.values()];
      const enrollments = await tx.sequenceEnrollment.findMany({
        where: { tenantId: auth.tenantId, createdAt: { gte: since }, ...(mine ? { senderId: mine } : {}) },
        select: { sequenceId: true, status: true },
      });
      const runMap = new Map<string, { sequence_id: string; enrolled: number; completed: number; failed: number }>();
      for (const e of enrollments) {
        let r = runMap.get(e.sequenceId);
        if (!r) runMap.set(e.sequenceId, (r = { sequence_id: e.sequenceId, enrolled: 0, completed: 0, failed: 0 }));
        r.enrolled++;
        if (e.status === 'COMPLETED') r.completed++;
        if (e.status === 'FAILED') r.failed++;
      }
      const runs = [...runMap.values()];

      const seqIds = [...new Set([...rows.map((r) => r.sequence_id), ...runs.map((r) => r.sequence_id)])];
      const sequences = await tx.sequence.findMany({ where: { tenantId: auth.tenantId, id: { in: seqIds } } });
      const senders = [...new Set(rows.map((r) => r.sender_id))];
      const [users, boxes] = await Promise.all([
        tx.user.findMany({ where: { id: { in: senders } }, select: { id: true, name: true } }),
        tx.integrationConnection.findMany({ where: { tenantId: auth.tenantId, userId: { in: senders } }, select: { userId: true, accountEmail: true, status: true } }),
      ]);

      // Which template and position each (sequence, step, version) used, from the sequence's current steps.
      const stepInfo = new Map<string, { templateId: string | null; position: number }>();
      for (const s of sequences) {
        let position = 0;
        for (const st of seqSteps(s)) {
          if (st.type !== 'email') continue;
          position++;
          stepInfo.set(`${s.id}:${st.id}:A`, { templateId: st.templateId, position });
          stepInfo.set(`${s.id}:${st.id}:B`, { templateId: st.variantB?.templateId ?? null, position });
        }
      }
      const templateIds = [...new Set([...stepInfo.values()].flatMap((v) => (v.templateId ? [v.templateId] : [])))];
      const templates = new Map((await tx.emailTemplate.findMany({ where: { tenantId: auth.tenantId, id: { in: templateIds } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));

      const total = zero();
      const bySeq = new Map<string, Counts>();
      const byBox = new Map<string, Counts>();
      const byTpl = new Map<string, Counts>();
      const byPos = new Map<number, Counts>();
      const bump = <K>(m: Map<K, Counts>, k: K, r: Row) => {
        if (!m.has(k)) m.set(k, zero());
        add(m.get(k)!, r);
      };
      for (const r of rows) {
        add(total, r);
        bump(bySeq, r.sequence_id, r);
        bump(byBox, r.sender_id, r);
        const info = stepInfo.get(`${r.sequence_id}:${r.step_id}:${r.variant}`);
        bump(byTpl, info?.templateId ?? 'none', r);
        bump(byPos, info?.position ?? 0, r);
      }
      const insights = await this.insights(tx, messages, rows, sequences);
      const runOf = (id: string) => runs.find((x) => x.sequence_id === id) ?? { enrolled: 0, completed: 0, failed: 0 };
      return {
        days: q.days,
        scope: q.scope,
        totals: { ...rates(total), enrolled: runs.reduce((n, r) => n + r.enrolled, 0), completed: runs.reduce((n, r) => n + r.completed, 0), failed: runs.reduce((n, r) => n + r.failed, 0) },
        bySequence: sequences
          .map((s) => ({ id: s.id, name: s.name, status: s.status as SequenceStatus, enrolled: runOf(s.id).enrolled, completed: runOf(s.id).completed, abTested: seqSteps(s).some((st) => st.type === 'email' && !!st.variantB), ...rates(bySeq.get(s.id) ?? zero()) }))
          .sort((a, b) => b.sent - a.sent),
        byMailbox: senders
          .map((id) => ({ userId: id, name: users.find((u) => u.id === id)?.name ?? 'Former member', mailbox: boxes.find((b) => b.userId === id)?.accountEmail ?? null, ...rates(byBox.get(id) ?? zero()) }))
          .sort((a, b) => b.sent - a.sent),
        byTemplate: [...byTpl.entries()]
          .map(([id, c]) => ({ id: id === 'none' ? null : id, name: id === 'none' ? 'Written in the step' : (templates.get(id) ?? 'Deleted template'), ...rates(c) }))
          .sort((a, b) => b.sent - a.sent),
        byStepPosition: [...byPos.entries()].filter(([p]) => p > 0).sort(([a], [b]) => a - b).map(([position, c]) => ({ position, ...rates(c) })),
        insights,
      };
    });
  }

  /**
   * Rule-based tips. Thresholds are deliberately conservative and every tip states its numbers, so a small
   * sample never reads as a finding.
   */
  private async insights(tx: TenantTx, messages: SentMessage[], rows: Row[], sequences: { id: string; name: string; steps: unknown }[]): Promise<EmailInsight[]> {
    const out: EmailInsight[] = [];
    const name = (id: string) => sequences.find((s) => s.id === id)?.name ?? 'A sequence';
    const position = new Map<string, number>();
    for (const s of sequences) {
      let n = 0;
      for (const st of seqSteps(s as Parameters<typeof seqSteps>[0])) if (st.type === 'email') position.set(`${s.id}:${st.id}`, ++n);
    }
    const bySeqStep = new Map<string, Counts & { variants: Map<string, Counts> }>();
    const bySeq = new Map<string, Counts>();
    for (const r of rows) {
      const k = `${r.sequence_id}:${r.step_id}`;
      if (!bySeqStep.has(k)) bySeqStep.set(k, { ...zero(), variants: new Map() });
      const e = bySeqStep.get(k)!;
      add(e, r);
      if (!e.variants.has(r.variant)) e.variants.set(r.variant, zero());
      add(e.variants.get(r.variant)!, r);
      if (!bySeq.has(r.sequence_id)) bySeq.set(r.sequence_id, zero());
      add(bySeq.get(r.sequence_id)!, r);
    }
    for (const [k, c] of bySeqStep) {
      const [seqId] = k.split(':') as [string];
      const pos = position.get(k);
      if (c.sent >= 20 && c.replied === 0) {
        out.push({ kind: 'quiet_step', severity: 'warning', sequenceId: seqId, facts: { sequence: name(seqId), email: pos ?? '?', sent: c.sent }, title: `${name(seqId)}: email ${pos ?? '?'} has no replies`, detail: `${c.sent} sent in this period and none answered. Try a different angle or a shorter email; the Email Assistant can rewrite it.` });
      }
      const a = c.variants.get('A');
      const b = c.variants.get('B');
      if (a && b && a.sent >= 30 && b.sent >= 30) {
        const pa = a.replied / a.sent;
        const pb = b.replied / b.sent;
        const p = (a.replied + b.replied) / (a.sent + b.sent);
        const se = Math.sqrt(p * (1 - p) * (1 / a.sent + 1 / b.sent));
        const z = se > 0 ? (pb - pa) / se : 0;
        if (Math.abs(z) >= 1.96) {
          const lead = z > 0 ? 'B' : 'A';
          out.push({ kind: 'ab_leader', severity: 'info', sequenceId: seqId, facts: { sequence: name(seqId), email: pos ?? '?', leader: lead, rateA: Math.round(pa * 100), sentA: a.sent, rateB: Math.round(pb * 100), sentB: b.sent }, title: `${name(seqId)}: version ${lead} of email ${pos ?? '?'} gets more replies`, detail: `Version A ${Math.round(pa * 100)}% of ${a.sent}, version B ${Math.round(pb * 100)}% of ${b.sent}. The gap is unlikely to be chance (95% level); consider keeping version ${lead}.` });
        }
      }
    }
    for (const [seqId, c] of bySeq) {
      if (c.sent >= 20 && c.bounced / c.sent >= 0.05) {
        out.push({ kind: 'high_bounce', severity: 'warning', sequenceId: seqId, facts: { sequence: name(seqId), rate: Math.round((c.bounced / c.sent) * 100), bounced: c.bounced, sent: c.sent }, title: `${name(seqId)}: ${Math.round((c.bounced / c.sent) * 100)}% of emails bounced`, detail: `${c.bounced} of ${c.sent} bounced. Verify addresses before enrolling more people; a high bounce rate can hurt your mailbox's reputation.` });
      }
    }
    const hours = messages
      .filter((m) => m.repliedAt && m.repliedAt >= m.sentAt)
      .map((m) => (m.repliedAt!.getTime() - m.sentAt.getTime()) / 3_600_000)
      .sort((x, y) => x - y);
    const timing = [{ n: hours.length, median_hours: percentileCont(hours, 0.5) }];
    const t = timing[0];
    if (t && t.n >= 10 && t.median_hours !== null) {
      const days = Math.max(1, Math.round(t.median_hours / 24));
      const facts: Record<string, number> = t.median_hours < 24 ? { replies: t.n, hours: Math.max(1, Math.round(t.median_hours)), waitDays: days + 1 } : { replies: t.n, days, waitDays: days + 1 };
      out.push({ kind: 'reply_timing', severity: 'info', sequenceId: null, facts, title: `Half of replies arrive within ${t.median_hours < 24 ? `${Math.max(1, Math.round(t.median_hours))} hours` : `${days} day${days === 1 ? '' : 's'}`}`, detail: `From ${t.n} replies in this period. Waiting about ${days + 1} day${days + 1 === 1 ? '' : 's'} before a follow-up gives most people time to answer first.` });
    }
    const quiet = await disengaged(tx, messages);
    if (quiet.length) {
      out.push({
        kind: 'disengaged',
        severity: 'info',
        sequenceId: null,
        facts: { people: quiet.length },
        title: `${quiet.length} ${quiet.length === 1 ? 'person has' : 'people have'} had 3 or more emails with no reply, open or click`,
        detail: 'Consider pausing them or trying another channel. Opens are often blocked, so some may still be reading.',
        people: quiet.slice(0, 10).map((q) => ({ name: q.name ?? q.email, leadId: q.leadId, contactId: q.contactId })),
      });
    }
    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1));
  }
}

type SentMessage = Awaited<ReturnType<typeof sentMessages>>[number];

/** Sequence emails sent since `since` (optionally only one sender's), with what each enrollment needs for grouping. */
function sentMessages(tx: TenantTx, tenantId: string, since: Date, senderId: string | null) {
  return tx.sequenceMessage.findMany({
    where: { tenantId, sentAt: { gte: since }, ...(senderId ? { enrollment: { senderId } } : {}) },
    select: {
      stepId: true, variant: true, sentAt: true, repliedAt: true, openedAt: true, clickedAt: true, bouncedAt: true,
      enrollment: { select: { id: true, sequenceId: true, senderId: true, leadId: true, contactId: true, email: true } },
      events: { where: { type: 'UNSUBSCRIBED' }, select: { id: true }, take: 1 },
    },
  });
}

/** People sent 3 or more emails in the period with no reply, open, click or bounce, most recently emailed first. */
async function disengaged(tx: TenantTx, messages: SentMessage[]): Promise<Array<{ leadId: string | null; contactId: string | null; name: string | null; email: string }>> {
  const byEnrollment = new Map<string, { e: SentMessage['enrollment']; n: number; touched: boolean; last: number }>();
  for (const m of messages) {
    let x = byEnrollment.get(m.enrollment.id);
    if (!x) byEnrollment.set(m.enrollment.id, (x = { e: m.enrollment, n: 0, touched: false, last: 0 }));
    x.n++;
    if (m.repliedAt || m.openedAt || m.clickedAt || m.bouncedAt) x.touched = true;
    x.last = Math.max(x.last, m.sentAt.getTime());
  }
  const quiet = [...byEnrollment.values()].filter((x) => x.n >= 3 && !x.touched).sort((a, b) => b.last - a.last);
  // Names only for the people shown (the insight lists ten).
  const shown = quiet.slice(0, 10);
  const leadIds = shown.flatMap((x) => (x.e.leadId ? [x.e.leadId] : []));
  const contactIds = shown.flatMap((x) => (x.e.contactId ? [x.e.contactId] : []));
  const [leads, contacts] = await Promise.all([
    leadIds.length ? tx.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, fullName: true } }) : [],
    contactIds.length ? tx.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
  ]);
  const nameOf = (x: (typeof quiet)[number]): string | null => {
    const l = x.e.leadId ? leads.find((r) => r.id === x.e.leadId) : undefined;
    if (l?.fullName) return l.fullName;
    const c = x.e.contactId ? contacts.find((r) => r.id === x.e.contactId) : undefined;
    const n = c ? [c.firstName, c.lastName].filter(Boolean).join(' ').trim() : '';
    return n || null;
  };
  return quiet.map((x) => ({ leadId: x.e.leadId, contactId: x.e.contactId, email: x.e.email, name: nameOf(x) }));
}
