import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { AnalyticsCounts, EmailAnalytics, EmailAnalyticsQuery, SequenceStatus } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { seqSteps } from './sequences.service';

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
      const mine = q.scope === 'mine' ? Prisma.sql`AND e.sender_id = ${auth.userId}::uuid` : Prisma.empty;
      const rows = await tx.$queryRaw<Row[]>`
        SELECT e.sequence_id, e.sender_id, m.step_id, m.variant,
               count(*)::int AS sent, count(m.replied_at)::int AS replied, count(m.opened_at)::int AS opened,
               count(m.clicked_at)::int AS clicked, count(m.bounced_at)::int AS bounced,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_events v WHERE v.message_id = m.id AND v.type = 'UNSUBSCRIBED'))::int AS unsubscribed
          FROM sequence_messages m JOIN sequence_enrollments e ON e.id = m.enrollment_id
         WHERE m.tenant_id = ${auth.tenantId}::uuid AND m.sent_at >= ${since} ${mine}
         GROUP BY e.sequence_id, e.sender_id, m.step_id, m.variant`;
      const runs = await tx.$queryRaw<{ sequence_id: string; enrolled: number; completed: number; failed: number }[]>`
        SELECT e.sequence_id, count(*)::int AS enrolled,
               count(*) FILTER (WHERE e.status = 'COMPLETED')::int AS completed,
               count(*) FILTER (WHERE e.status = 'FAILED')::int AS failed
          FROM sequence_enrollments e
         WHERE e.tenant_id = ${auth.tenantId}::uuid AND e.created_at >= ${since} ${mine}
         GROUP BY e.sequence_id`;

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
      };
    });
  }
}
