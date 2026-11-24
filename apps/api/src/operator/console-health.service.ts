import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type ClientHealth,
  type ClientHealthSignal,
  type ConsoleClientRow,
  DEFAULT_HEALTH_SETTINGS,
  HEALTH_SIGNALS,
  type ClientHealthBand,
  healthBandOf,
  type HealthSettings,
  type HealthSettingsInput,
  type ClientHealthKey,
} from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { ConsoleService } from './console.service';
import type { OperatorContext } from './operator-auth';
import { changedFields, writePlatformAudit } from './platform-audit';

export const HEALTH_SETTINGS_KEY = 'console.health';
const DAY = 86_400_000;
/** Clients measured per worker pass, so a large platform spreads the work over a few passes. */
const BATCH = 25;
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Client organisation not found.' };
/** Record types whose use counts as feature adoption: any created in the last 30 days. */
const ADOPTION = ['contact', 'company', 'opportunity', 'activity', 'task', 'rfq'] as const;
const OPEN_TICKET = ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'AWAITING_USER'] as const;

type Measure = { applies: boolean; ratio: number; count: number | null; total: number | null; status: string | null };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Client health score (ADR 0074, C5). Once a day the worker measures every client from data the platform already
 * stores: who signs in, workspaces used against the limits, which parts of the CRM are in use, phones, payment,
 * support load and the subscription. Each signal scores 0 to 1 and is weighted by Settings → Health score. The score
 * is advisory and never blocks anything. Changing the weights measures every client again on the next passes.
 */
@Injectable()
export class ConsoleHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
  ) {}

  async settings(): Promise<HealthSettings & { updatedAt: string | null; updatedBy: string | null }> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: HEALTH_SETTINGS_KEY } });
    const by = row?.updatedById ? await this.prisma.platformOperator.findUnique({ where: { id: row.updatedById }, select: { name: true } }) : null;
    return { ...parseSettings(row?.value), updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: by?.name ?? null };
  }

  async saveSettings(op: OperatorContext, input: HealthSettingsInput, ip: string | null) {
    const before = await this.settings();
    const next: HealthSettings = { weights: input.weights, thresholds: input.thresholds };
    await this.prisma.platformSetting.upsert({
      where: { key: HEALTH_SETTINGS_KEY },
      create: { key: HEALTH_SETTINGS_KEY, value: JSON.stringify(next), updatedById: op.id },
      update: { value: JSON.stringify(next), updatedById: op.id },
    });
    const diff = changedFields(flat(before), flat(next));
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'settings.health_updated', target: { type: 'setting', id: HEALTH_SETTINGS_KEY, label: 'Health score' }, before: diff.before, after: diff.after, ip });
    return this.settings();
  }

  /**
   * The worker's pass: clients not measured today, or measured before the weights last changed, oldest first.
   * Returns how many were measured. `only` keeps a pass to some clients (tests share a database with every other suite).
   */
  async sweep(now = new Date(), only?: string[]): Promise<number> {
    const saved = await this.prisma.platformSetting.findUnique({ where: { key: HEALTH_SETTINGS_KEY } });
    const settings = parseSettings(saved?.value);
    const today = new Date(`${utcDay(now)}T00:00:00Z`);
    const cutoff = saved && saved.updatedAt > today ? saved.updatedAt : today;
    const due = await this.prisma.run({ operatorScan: true }, (tx) =>
      tx.tenant.findMany({ where: { deletedAt: null, ...(only ? { id: { in: only } } : {}), OR: [{ healthAt: null }, { healthAt: { lt: cutoff } }] }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: BATCH }),
    );
    for (const t of due) await this.measure(t.id, settings, now);
    return due.length;
  }

  /** Measures one client now and stores the score. */
  async measure(id: string, settings?: HealthSettings, now = new Date()): Promise<ClientHealth> {
    const row = (await this.console.rows({ id }))[0];
    if (!row) throw new NotFoundException(NOT_FOUND);
    const s = settings ?? parseSettings((await this.prisma.platformSetting.findUnique({ where: { key: HEALTH_SETTINGS_KEY } }))?.value);
    const measures = await this.signals(row, now);
    const { score, signals } = scoreOf(measures, s.weights);
    const band = healthBandOf(score, s.thresholds);
    const day = utcDay(now);
    await this.prisma.run({ tenantId: id }, async (tx) => {
      await tx.clientHealthDaily.upsert({
        where: { tenantId_day: { tenantId: id, day } },
        create: { tenantId: id, day, score, band, signals: signals as object[] },
        update: { score, band, signals: signals as object[] },
      });
      await tx.tenant.update({ where: { id }, data: { healthScore: score, healthBand: band, healthAt: now } });
    });
    return (await this.detail(id))!;
  }

  /** The client's latest score with every signal, and up to 30 days of history; null before the first measurement. */
  async detail(id: string): Promise<ClientHealth | null> {
    const rows = await this.prisma.run({ operatorScan: true }, async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!tenant) throw new NotFoundException(NOT_FOUND);
      return tx.clientHealthDaily.findMany({ where: { tenantId: id }, orderBy: { day: 'desc' }, take: 30 });
    });
    const latest = rows[0];
    if (!latest) return null;
    return {
      score: latest.score,
      band: latest.band as ClientHealthBand,
      at: latest.updatedAt.toISOString(),
      signals: latest.signals as unknown as ClientHealthSignal[],
      history: rows.map((r) => ({ day: r.day, score: r.score })).reverse(),
    };
  }

  /** An operator asks for a fresh measurement from the client page. */
  async remeasure(op: OperatorContext, id: string, ip: string | null): Promise<ClientHealth> {
    const before = await this.detail(id);
    const after = await this.measure(id);
    const name = (await this.console.rows({ id }))[0]?.name ?? id;
    await writePlatformAudit(this.prisma, {
      operatorId: op.id,
      action: 'client.health_measured',
      tenantId: id,
      target: { type: 'client', id, label: name },
      before: before ? { score: before.score, band: before.band } : null,
      after: { score: after.score, band: after.band },
      ip,
    });
    return after;
  }

  private async signals(row: ConsoleClientRow, now: Date): Promise<Record<ClientHealthKey, Measure>> {
    const id = row.id;
    const since14 = new Date(now.getTime() - 14 * DAY);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const since48h = new Date(now.getTime() - 2 * DAY);
    const sub = row.subscription;
    const counts = await this.prisma.run({ tenantId: id }, async (tx) => {
      const [members, sessions, adopted, mobile, phones, open, stale] = await Promise.all([
        tx.membership.findMany({ where: { tenantId: id, status: 'ACTIVE' }, select: { userId: true } }),
        tx.session.findMany({ where: { activeTenantId: id, createdAt: { gte: since14 } }, select: { userId: true }, distinct: ['userId'] }),
        Promise.all([
          tx.contact.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
          tx.company.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
          tx.opportunity.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
          tx.activity.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
          tx.task.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
          tx.rfq.findFirst({ where: { tenantId: id, createdAt: { gte: since30 } }, select: { id: true } }),
        ]),
        tx.mobileAccess.findUnique({ where: { tenantId: id }, select: { status: true, activatedAt: true, maxDevices: true } }),
        tx.mobileDevice.findMany({ where: { tenantId: id, signedOutAt: null, lastSeenAt: { gte: since14 } }, select: { userId: true }, distinct: ['userId'] }),
        tx.supportTicket.count({ where: { tenantId: id, status: { in: [...OPEN_TICKET] } } }),
        tx.supportTicket.count({ where: { tenantId: id, status: { in: [...OPEN_TICKET] }, createdAt: { lt: since48h } } }),
      ]);
      return { members, sessions, adopted, mobile, phones, open, stale };
    });
    const memberIds = new Set(counts.members.map((m) => m.userId));
    const signedIn = counts.sessions.filter((s) => memberIds.has(s.userId)).length;
    const people = memberIds.size;

    const allowed = (sub?.limits.managers ?? 0) + (sub?.limits.executives ?? 0);
    const used = (sub?.limits.managers !== null && sub?.limits.managers !== undefined ? row.usage.managers : 0) + (sub?.limits.executives !== null && sub?.limits.executives !== undefined ? row.usage.executives : 0);

    const adopted = counts.adopted.filter(Boolean).length;

    const mobileOn = counts.mobile?.status === 'APPROVED' && !!counts.mobile.activatedAt;
    const seats = counts.mobile?.maxDevices ?? people;

    const payment = sub?.paymentStatus ?? null;
    const paymentRatio = sub?.status === 'UNPAID' ? 0 : sub?.status === 'PAST_DUE' ? 0.25 : payment === 'OVERDUE' ? 0 : payment === 'PENDING' ? 0.5 : 1;

    const renewsSoon = sub?.renewsOn ? new Date(`${sub.renewsOn}T00:00:00Z`).getTime() - now.getTime() < 14 * DAY : false;
    const subRatio =
      row.state !== 'ACTIVE' || !sub
        ? 0
        : sub.status === 'ACTIVE'
          ? renewsSoon && !sub.autoRenew
            ? 0.6
            : 1
          : sub.status === 'TRIALING'
            ? 0.7
            : sub.status === 'PAST_DUE'
              ? 0.3
              : 0;

    return {
      login: { applies: people > 0, ratio: people ? clamp(signedIn / people) : 0, count: signedIn, total: people, status: null },
      workspaces: { applies: allowed > 0, ratio: allowed ? clamp(used / allowed) : 0, count: used, total: allowed || null, status: null },
      features: { applies: true, ratio: adopted / ADOPTION.length, count: adopted, total: ADOPTION.length, status: null },
      mobile: { applies: mobileOn, ratio: mobileOn ? clamp(counts.phones.length / Math.max(1, seats)) : 0, count: counts.phones.length, total: mobileOn ? seats : null, status: counts.mobile?.status ?? 'OFF' },
      // A subscription with no payment status (a trial, or terms not agreed yet) has nothing to measure.
      payment: { applies: !!sub && (payment !== null || sub.status === 'PAST_DUE' || sub.status === 'UNPAID'), ratio: paymentRatio, count: null, total: null, status: sub?.status === 'PAST_DUE' || sub?.status === 'UNPAID' ? sub.status : payment },
      support: { applies: true, ratio: clamp(1 - 0.2 * counts.open - 0.2 * counts.stale), count: counts.open, total: counts.stale, status: null },
      subscription: { applies: true, ratio: subRatio, count: null, total: null, status: row.state !== 'ACTIVE' ? row.state : (sub?.status ?? 'NONE') },
    };
  }
}

/** Weights that apply are scaled to 100; each signal adds its ratio of its share. */
export function scoreOf(measures: Record<ClientHealthKey, Measure>, weights: HealthSettings['weights']): { score: number; signals: ClientHealthSignal[] } {
  const total = HEALTH_SIGNALS.reduce((a, k) => a + (measures[k].applies ? weights[k] : 0), 0);
  const signals = HEALTH_SIGNALS.map((key) => {
    const m = measures[key];
    const weight = weights[key];
    const counted = m.applies && weight > 0 && total > 0;
    const maxPoints = counted ? (weight * 100) / total : 0;
    return { key, weight, applies: m.applies, ratio: round(m.ratio, 2), points: round(m.ratio * maxPoints, 1), maxPoints: round(maxPoints, 1), count: m.count, total: m.total, status: m.status };
  });
  const score = Math.round(signals.reduce((a, x) => a + x.points, 0));
  return { score: Math.max(0, Math.min(100, score)), signals };
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export function parseSettings(value: string | null | undefined): HealthSettings {
  if (!value) return DEFAULT_HEALTH_SETTINGS;
  try {
    const v = JSON.parse(value) as Partial<HealthSettings>;
    return { weights: { ...DEFAULT_HEALTH_SETTINGS.weights, ...v.weights }, thresholds: { ...DEFAULT_HEALTH_SETTINGS.thresholds, ...v.thresholds } };
  } catch {
    return DEFAULT_HEALTH_SETTINGS;
  }
}

function flat(s: HealthSettings): Record<string, unknown> {
  return { ...Object.fromEntries(HEALTH_SIGNALS.map((k) => [`weight.${k}`, s.weights[k]])), healthyFrom: s.thresholds.healthy, atRiskFrom: s.thresholds.atRisk };
}
