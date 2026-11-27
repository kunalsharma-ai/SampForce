import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type CompanyJourney,
  type JourneyBoard,
  type JourneyBoardQuery,
  type JourneyCard,
  type JourneyFacts,
  type JourneyKey,
  type JourneyPathKey,
  type JourneySettings,
  type JourneySettingsInput,
  type JourneyStageRow,
  journeyProgressOf,
  journeyStageOf,
  journeyStagesOf,
  journeySteps,
  RFQ_OPEN_STATUSES,
  type StageKey,
  visibleJourneyKey,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { cadenceStates } from './cadence-state';
import { CompanyLogosService } from './company-logos.service';
import { notFound } from './crm-helpers';
import { inSuperWorkspace } from './super-workspace';
import { companyScope, personRefs, visibility } from './visibility';

type CompanyLite = { id: string; name: string; leadNumber: string | null; ownerId: string | null; statusId: string | null; statusChangedAt: Date | null; wonDealId: string | null; wonAt: Date | null; createdAt: Date; updatedAt: Date };
const companySelect = { id: true, name: true, leadNumber: true, ownerId: true, statusId: true, statusChangedAt: true, wonDealId: true, wonAt: true, createdAt: true, updatedAt: true } as const;

interface Worked {
  facts: JourneyFacts;
  stage: JourneyKey;
  progress: JourneyPathKey;
  followUp: JourneyCard['followUp'];
  nextAction: JourneyCard['nextAction'];
  employees: number;
  openRfqs: number;
  at: Partial<Record<JourneyKey, string | null>>;
}

/**
 * The company journey and the Pipeline journey board (redesign R5, ADR 0085). The journey stage is worked out from
 * the company's employees, RFQs, deals and status every time, so it is never stored or typed twice.
 */
@Injectable()
export class JourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logos: CompanyLogosService,
  ) {}

  // ───────────── Settings ─────────────

  settings(auth: AuthContext): Promise<JourneySettings> {
    return this.prisma.run(auth, (tx) => this.settingsIn(tx, auth));
  }

  private async stagesIn(tx: TenantTx, tenantId: string): Promise<JourneyStageRow[]> {
    const row = await tx.crmSettings.findUnique({ where: { tenantId }, select: { journeyStages: true } });
    return journeyStagesOf(row?.journeyStages);
  }

  private async settingsIn(tx: TenantTx, auth: AuthContext): Promise<JourneySettings> {
    const row = await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { journeyStages: true } });
    const raw = (row?.journeyStages ?? {}) as Record<string, unknown>;
    const byId = typeof raw.updatedById === 'string' ? raw.updatedById : null;
    return {
      stages: journeyStagesOf(raw),
      canEdit: auth.permissions.includes('crm:configure') && (await inSuperWorkspace(tx, auth)),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      updatedBy: byId ? await tx.user.findUnique({ where: { id: byId }, select: { id: true, name: true } }) : null,
    };
  }

  /** Only the Super Workspace renames, recolours or hides journey stages. */
  setSettings(auth: AuthContext, input: JourneySettingsInput, meta: RequestMeta): Promise<JourneySettings> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await inSuperWorkspace(tx, auth))) throw new ForbiddenException({ code: 'JOURNEY_SUPER_ONLY', message: 'Only the Super Workspace changes the journey stages.' });
      const value = { stages: input.stages, updatedAt: new Date().toISOString(), updatedById: auth.userId };
      await tx.crmSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, journeyStages: value as Prisma.InputJsonValue, updatedById: auth.userId },
        update: { journeyStages: value as Prisma.InputJsonValue, updatedById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.journey_updated', entityType: 'tenant', entityId: auth.tenantId, metadata: { stages: input.stages }, meta });
      return this.settingsIn(tx, auth);
    });
  }

  // ───────────── Board and journey ─────────────

  /** Every company the caller can see, as a card in its journey column. */
  board(auth: AuthContext, q: JourneyBoardQuery): Promise<JourneyBoard> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const ownerId = q.mine === 'true' ? auth.userId : q.ownerId;
      const companies = await tx.company.findMany({
        where: {
          tenantId: auth.tenantId,
          deletedAt: null,
          ...companyScope(v),
          ...(ownerId ? { ownerId } : {}),
          ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { leadNumber: { contains: q.q, mode: 'insensitive' } }] } : {}),
        },
        select: companySelect,
        orderBy: { updatedAt: 'desc' },
        take: 5000,
      });
      const stages = await this.stagesIn(tx, auth.tenantId);
      const hidden = new Set(stages.filter((s) => s.hidden).map((s) => s.key));
      const worked = await this.work(tx, auth.tenantId, companies);
      const [statuses, people, logos] = await Promise.all([
        this.statusRefs(tx, auth.tenantId, companies.map((c) => c.statusId)),
        personRefs(tx, auth.tenantId, companies.map((c) => c.ownerId)),
        this.logos.refsIn(tx, auth.tenantId, companies.map((c) => c.id)),
      ]);
      const cards = companies.map((c): JourneyCard => {
        const w = worked.get(c.id)!;
        return {
          companyId: c.id,
          name: c.name,
          leadNumber: c.leadNumber,
          logoUrl: logos.get(c.id)?.url ?? null,
          owner: c.ownerId ? (people.get(c.ownerId) ?? null) : null,
          status: c.statusId ? (statuses.get(c.statusId) ?? null) : null,
          stage: visibleJourneyKey(w.stage, hidden),
          followUp: w.followUp,
          nextAction: w.nextAction,
          employees: w.employees,
          openRfqs: w.openRfqs,
          updatedAt: c.updatedAt.toISOString(),
        };
      });
      // Overdue first, then by what is due soonest, then the most recently touched.
      const due = (c: JourneyCard) => (c.nextAction?.dueAt ? Date.parse(c.nextAction.dueAt) : Number.POSITIVE_INFINITY);
      cards.sort((a, b) => Number(!!b.nextAction?.overdue) - Number(!!a.nextAction?.overdue) || due(a) - due(b) || b.updatedAt.localeCompare(a.updatedAt));
      return {
        total: cards.length,
        columns: stages.filter((s) => !s.hidden).map((stage) => {
          const mine = cards.filter((c) => c.stage === stage.key);
          return { stage, total: mine.length, cards: mine.slice(0, q.perStage) };
        }),
      };
    });
  }

  /** One company's visual journey: steps done, current, next and pending, or where it ended. */
  companyJourney(auth: AuthContext, companyId: string): Promise<CompanyJourney> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const c = await tx.company.findFirst({ where: { id: companyId, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: companySelect });
      if (!c) throw notFound('Company');
      const stages = await this.stagesIn(tx, auth.tenantId);
      const w = (await this.work(tx, auth.tenantId, [c])).get(c.id)!;
      return { companyId: c.id, name: c.name, stage: visibleJourneyKey(w.stage, new Set(stages.filter((s) => s.hidden).map((s) => s.key))), progress: w.progress, steps: journeySteps(w.stage, w.progress, stages, w.at) };
    });
  }

  /** Works out the journey of a set of companies with one query per kind of record. */
  private async work(tx: TenantTx, tenantId: string, companies: CompanyLite[]): Promise<Map<string, Worked>> {
    const ids = companies.map((c) => c.id);
    const out = new Map<string, Worked>();
    if (!ids.length) return out;
    const now = new Date();
    const [statusRows, contacts, deals, rfqs, tasks] = await Promise.all([
      tx.crmStatus.findMany({ where: { tenantId, id: { in: [...new Set(companies.map((c) => c.statusId).filter((s): s is string => !!s))] } }, select: { id: true, name: true, meaning: true } }),
      tx.contact.findMany({ where: { tenantId, companyId: { in: ids }, deletedAt: null }, select: { id: true, companyId: true, stageId: true, initialEmailAt: true } }),
      tx.opportunity.findMany({ where: { tenantId, companyId: { in: ids }, deletedAt: null, status: { in: ['OPEN', 'WON'] } }, select: { companyId: true, status: true, createdAt: true, closedAt: true } }),
      tx.rfq.findMany({ where: { tenantId, companyId: { in: ids }, deletedAt: null }, select: { companyId: true, status: true, receivedAt: true } }),
      tx.task.findMany({ where: { tenantId, companyId: { in: ids }, deletedAt: null, status: 'OPEN' }, select: { companyId: true, title: true, dueAt: true }, orderBy: { dueAt: 'asc' }, take: 20_000 }),
    ]);
    const stageIds = [...new Set(contacts.map((c) => c.stageId).filter((s): s is string => !!s))];
    const stageKey = new Map((stageIds.length ? await tx.crmStatus.findMany({ where: { tenantId, id: { in: stageIds } }, select: { id: true, key: true } }) : []).map((s) => [s.id, s.key as StageKey | null]));
    const cadence = await cadenceStates(tx, tenantId, contacts.map((c) => c.id), now);
    const doneFollowUps = await tx.task.findMany({ where: { tenantId, companyId: { in: ids }, deletedAt: null, cadenceStep: { not: null }, status: 'DONE' }, select: { companyId: true, completedAt: true } });
    const statusById = new Map(statusRows.map((s) => [s.id, s]));
    const min = (dates: (Date | null | undefined)[]) => dates.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null;
    for (const c of companies) {
      const status = c.statusId ? statusById.get(c.statusId) : undefined;
      const people = contacts.filter((p) => p.companyId === c.id);
      const myDeals = deals.filter((d) => d.companyId === c.id);
      const myRfqs = rfqs.filter((r) => r.companyId === c.id);
      const openRfqs = myRfqs.filter((r) => RFQ_OPEN_STATUSES.includes(r.status as (typeof RFQ_OPEN_STATUSES)[number]));
      const facts: JourneyFacts = {
        statusMeaning: status?.meaning ?? null,
        statusName: status?.name ?? null,
        won: !!c.wonDealId || myDeals.some((d) => d.status === 'WON'),
        openDeal: myDeals.some((d) => d.status === 'OPEN'),
        openRfq: openRfqs.length > 0,
        contactStages: people.map((p) => (p.stageId ? (stageKey.get(p.stageId) ?? null) : null)),
      };
      // "Follow-up 2 of 5": the employee furthest along a running cadence.
      const running = people.map((p) => cadence.get(p.id)).filter((s) => s?.state === 'ACTIVE' && s.next);
      const furthest = running.sort((a, b) => b!.next!.step - a!.next!.step)[0];
      // Missing due dates sort first, so prefer a task that has one.
      const task = tasks.find((t) => t.companyId === c.id && t.dueAt) ?? tasks.find((t) => t.companyId === c.id);
      out.set(c.id, {
        facts,
        stage: journeyStageOf(facts),
        progress: journeyProgressOf(facts),
        followUp: furthest ? { step: furthest.next!.step, total: furthest.total } : null,
        nextAction: task ? { title: task.title, dueAt: task.dueAt?.toISOString() ?? null, overdue: !!task.dueAt && task.dueAt < now } : null,
        employees: people.length,
        openRfqs: openRfqs.length,
        at: {
          NEW: c.createdAt.toISOString(),
          INITIAL_EMAIL: min(people.map((p) => p.initialEmailAt)),
          FOLLOW_UP: min(doneFollowUps.filter((t) => t.companyId === c.id).map((t) => t.completedAt)),
          RFQ: min(myRfqs.map((r) => r.receivedAt)),
          NEGOTIATION: min(myDeals.map((d) => d.createdAt)),
          WON: c.wonAt?.toISOString() ?? (status?.meaning === 'CLIENT' ? (c.statusChangedAt?.toISOString() ?? null) : null),
          LOST: c.statusChangedAt?.toISOString() ?? null,
          REJECTED: c.statusChangedAt?.toISOString() ?? null,
          NOT_INTERESTED: c.statusChangedAt?.toISOString() ?? null,
          ON_HOLD: c.statusChangedAt?.toISOString() ?? null,
        },
      });
    }
    return out;
  }

  private async statusRefs(tx: TenantTx, tenantId: string, ids: (string | null)[]) {
    const want = [...new Set(ids.filter((s): s is string => !!s))];
    const rows = want.length ? await tx.crmStatus.findMany({ where: { tenantId, id: { in: want } }, select: { id: true, name: true, color: true, meaning: true } }) : [];
    return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, color: r.color, meaning: r.meaning }]));
  }
}
