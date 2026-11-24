import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type CompanyEnrichmentState,
  ENRICH_FIELDS,
  type EnrichField,
  type EnrichmentRun,
  type EnrichmentStatus,
  type EnrichmentTrigger,
  type FieldSource,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { featureNotIncluded, hasFeature } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { claimDue, errorMessage } from '../worker/queue';
import { logoDomain } from './company-logo-finder';
import { CompanyLogosService } from './company-logos.service';
import { notFound } from './crm-helpers';
import type { Candidate } from './enrichment/candidates';
import { type CompanyNow, merge, sourcesOf, type StoredFill, undo, userEdits } from './enrichment/merge';
import { type Page, pagesToRead, readWebsite } from './enrichment/website';
import { findItem, readItem } from './enrichment/wikidata';
import { siteFetcher } from './site-fetch';
import { canSeeDetails, companyScope, visibility } from './visibility';

export const AUTOFILL_USER_AGENT = 'SampForceBot/1.0 (company details from public pages; reads a few pages per company)';
const TIMEOUT_MS = 8000;
const PAGE_MAX_BYTES = 1_500_000;
const RUN_DEADLINE_MS = 45_000;
const BATCH = 4;
/** Runs that reached nothing are tried again after these waits, then given up (FAILED). */
const RETRY_AFTER_MS = [10 * 60_000, 6 * 60 * 60_000];
/** A claimed run that never finished (the worker stopped) becomes due again after this. */
const LEASE_MS = 5 * 60_000;
/** Imports queue their companies this far apart, so one import never hammers the worker or the sites. */
const IMPORT_SPACING_MS = 3000;
/** The Enrich button waits this long after a run finished, so it cannot be used to hammer a website. */
const MANUAL_COOLDOWN_MS = 60_000;

type Collected = { candidates: Candidate[]; sources: { url: string; kind: 'WEBSITE' | 'WIKIDATA' }[]; reached: boolean; error: string | null };

/**
 * Company auto-fill (ADR 0076). Runs are queued when a company is created or imported, when its website changes and
 * when someone presses Enrich; the worker reads the company's website and Wikidata and writes only empty fields
 * (enrichment/merge.ts). Each run keeps what it wrote, so it can be undone field by field.
 */
@Injectable()
export class CompanyEnrichmentService {
  private readonly log = new Logger(CompanyEnrichmentService.name);
  private inFlight: Promise<unknown> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logos: CompanyLogosService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── queueing (inside the caller's transaction) ─────────────

  /** Queues a run unless one is already waiting. Needs the plan feature and something to look up. */
  async queueIn(tx: TenantTx, tenantId: string, company: { id: string; name: string; domain: string | null }, trigger: EnrichmentTrigger, userId: string | null, delayMs = 0): Promise<boolean> {
    if (!(await hasFeature(tx, tenantId, 'company_enrichment'))) return false;
    if (!logoDomain(company.domain) && !this.wikidataOn()) return false;
    const waiting = await tx.companyEnrichment.findFirst({ where: { tenantId, companyId: company.id, status: 'PENDING' }, select: { id: true } });
    if (waiting) return false;
    await tx.companyEnrichment.create({
      data: { tenantId, companyId: company.id, status: 'PENDING', trigger, domain: logoDomain(company.domain), requestedById: userId, nextRunAt: new Date(Date.now() + delayMs) },
    });
    return true;
  }

  /** Queues runs for imported companies, spaced out. */
  async queueImportIn(tx: TenantTx, tenantId: string, companies: { id: string; name: string; domain: string | null }[], userId: string): Promise<number> {
    if (!companies.length || !(await hasFeature(tx, tenantId, 'company_enrichment'))) return 0;
    let n = 0;
    for (const c of companies) if (await this.queueIn(tx, tenantId, c, 'IMPORT', userId, n * IMPORT_SPACING_MS)) n++;
    return n;
  }

  /** The field sources after someone's change, or null when nothing in them changes. */
  userEdits(before: CompanyNow, input: Record<string, unknown>, userId: string): Record<string, FieldSource> | null {
    return userEdits(before, input, userId, new Date(), ENRICH_FIELDS);
  }

  // ───────────── routes ─────────────

  state(auth: AuthContext, companyId: string): Promise<CompanyEnrichmentState> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.visibleCompany(tx, auth, companyId);
      const rows = await tx.companyEnrichment.findMany({ where: { tenantId: auth.tenantId, companyId }, orderBy: { createdAt: 'desc' }, take: 10 });
      const people = new Map(
        (await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
      );
      return {
        runs: rows.map((r) => toRun(r, r.requestedById ? (people.get(r.requestedById) ?? null) : null)),
        fieldSources: publicSources(company.fieldSources),
        busy: rows.some((r) => r.status === 'PENDING'),
        canRun: !!logoDomain(company.domain) || this.wikidataOn(),
      };
    });
  }

  /** The Enrich button: looks the company up again now. */
  enrich(auth: AuthContext, companyId: string, meta: RequestMeta): Promise<CompanyEnrichmentState> {
    return this.prisma
      .run(auth, async (tx) => {
        if (!(await hasFeature(tx, auth.tenantId, 'company_enrichment'))) throw featureNotIncluded('company_enrichment');
        const company = await this.editableCompany(tx, auth, companyId);
        if (!logoDomain(company.domain) && !this.wikidataOn()) throw new ConflictException({ code: 'NO_WEBSITE', message: 'Add the company’s website first.' });
        const last = await tx.companyEnrichment.findFirst({ where: { tenantId: auth.tenantId, companyId }, orderBy: { createdAt: 'desc' } });
        if (last?.status === 'PENDING') throw new ConflictException({ code: 'ENRICHMENT_RUNNING', message: 'Auto-fill is already looking this company up.' });
        if (last?.finishedAt && Date.now() - last.finishedAt.getTime() < MANUAL_COOLDOWN_MS) {
          throw new HttpException({ code: 'TOO_SOON', message: 'This company was just looked up. Try again in a minute.' }, HttpStatus.TOO_MANY_REQUESTS);
        }
        await this.queueIn(tx, auth.tenantId, company, 'MANUAL', auth.userId);
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.enrich_requested', entityType: 'company', entityId: companyId, meta });
      })
      .then(() => this.state(auth, companyId));
  }

  /** Undoes a run, or some of its fields. */
  undo(auth: AuthContext, companyId: string, runId: string, fields: EnrichField[] | undefined, meta: RequestMeta): Promise<CompanyEnrichmentState> {
    return this.prisma
      .run(auth, async (tx) => {
        const company = await this.editableCompany(tx, auth, companyId);
        const run = await tx.companyEnrichment.findFirst({ where: { id: runId, tenantId: auth.tenantId, companyId } });
        if (!run) throw notFound('Auto-fill run');
        const result = undo(company as unknown as CompanyNow, run.fills as unknown as StoredFill[], run.id, fields, auth.userId, new Date());
        if (!result.undone.length) return;
        await tx.company.update({ where: { id: companyId }, data: { ...(result.data as Prisma.CompanyUncheckedUpdateInput), updatedById: auth.userId } });
        await tx.companyEnrichment.update({ where: { id: run.id }, data: { fills: result.fills as unknown as Prisma.InputJsonValue } });
        if (result.undone.includes('website')) await this.logos.domainChangedIn(tx, auth.tenantId, companyId, null);
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.autofill_undone', entityType: 'company', entityId: companyId,
          metadata: { runId: run.id, fields: result.undone }, meta,
        });
      })
      .then(() => this.state(auth, companyId));
  }

  private async visibleCompany(tx: TenantTx, auth: AuthContext, id: string) {
    const v = await visibility(tx, auth);
    const company = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) } });
    if (!company) throw notFound('Company');
    if (!canSeeDetails(v, company.ownerId)) throw new ForbiddenException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
    return company;
  }

  private async editableCompany(tx: TenantTx, auth: AuthContext, id: string) {
    if (!auth.permissions.includes('companies:write')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot change companies (companies:write).' });
    return this.visibleCompany(tx, auth, id);
  }

  private wikidataOn(): boolean {
    return this.env.COMPANY_AUTOFILL_WIKIDATA !== false;
  }

  // ───────────── worker ─────────────

  /** Claims a few due runs and works them in parallel, in the background (like logo look-ups). */
  async runDue(now = new Date(), wait = false): Promise<number> {
    if (this.inFlight) {
      if (wait) await this.inFlight;
      else return 0;
    }
    const claimed = await claimDue<{ id: string; tenantId: string; companyId: string; domain: string | null; attempts: number }>(this.prisma.companyEnrichment, {
      where: { status: 'PENDING', nextRunAt: { lte: now } },
      lease: { nextRunAt: new Date(now.getTime() + LEASE_MS) },
      select: { tenantId: true, companyId: true, domain: true, attempts: true },
      orderBy: { nextRunAt: 'asc' },
      limit: BATCH,
    });
    if (!claimed.length) return 0;
    const batch = Promise.all(claimed.map((c) => this.work(c))).finally(() => {
      if (this.inFlight === batch) this.inFlight = null;
    });
    this.inFlight = batch;
    if (wait) await batch;
    return claimed.length;
  }

  async settle(): Promise<void> {
    await this.inFlight;
  }

  private async work(c: { id: string; tenantId: string; companyId: string; domain: string | null; attempts: number }): Promise<void> {
    try {
      const company = await this.prisma.run({ tenantId: c.tenantId }, async (tx) => {
        if (!(await hasFeature(tx, c.tenantId, 'company_enrichment'))) return null;
        return tx.company.findFirst({ where: { id: c.companyId, tenantId: c.tenantId, deletedAt: null }, select: { id: true, name: true, domain: true } });
      });
      if (!company) {
        await this.finish(c, 'FAILED', [], [], 'The company was deleted, or auto-fill is not in the plan.');
        return;
      }
      const domain = logoDomain(company.domain) ?? c.domain;
      const collected = await Promise.race([
        this.collect(company.name, domain),
        new Promise<Collected>((resolve) => setTimeout(() => resolve({ candidates: [], sources: [], reached: false, error: 'Timed out' }), RUN_DEADLINE_MS).unref()),
      ]);
      const attempts = c.attempts + 1;
      if (!collected.reached && !collected.candidates.length) {
        const wait = RETRY_AFTER_MS[attempts - 1];
        if (wait) {
          await this.prisma.run({ tenantId: c.tenantId }, (tx) =>
            tx.companyEnrichment.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { attempts, nextRunAt: new Date(Date.now() + wait), error: collected.error } }),
          );
          return;
        }
        await this.finish(c, 'FAILED', [], collected.sources, collected.error ?? 'Nothing could be read.');
        return;
      }
      await this.apply(c, collected, attempts);
    } catch (err) {
      this.log.error({ err: errorMessage(err), tenantId: c.tenantId }, 'company auto-fill failed');
      await this.finish(c, 'FAILED', [], [], 'Auto-fill stopped with an error.').catch(() => undefined);
    }
  }

  /** Reads the website (and Wikidata), returning everything they offer. Never throws. */
  async collect(name: string, domain: string | null): Promise<Collected> {
    const net = siteFetcher({ userAgent: AUTOFILL_USER_AGENT, timeoutMs: TIMEOUT_MS, pageMaxBytes: PAGE_MAX_BYTES, fixtureUrl: this.env.LOGO_FIXTURE_URL });
    const sources: Collected['sources'] = [];
    const candidates: Candidate[] = [];
    let error: string | null = null;
    const wikidata = async (d: string | null) => {
      if (!this.wikidataOn()) return null;
      try {
        const item = await findItem((u) => net.json(u), { name, domain: d });
        if (!item) return null;
        sources.push({ url: `https://www.wikidata.org/wiki/${item.entity.id}`, kind: 'WIKIDATA' });
        const found = await readItem((u) => net.json(u), item.entity, item.byName);
        candidates.push(...found);
        return found;
      } catch (err) {
        this.log.warn({ err: errorMessage(err) }, 'wikidata look-up failed');
        return null;
      }
    };
    let site = domain;
    let wiki: Promise<unknown> = Promise.resolve();
    if (site) wiki = wikidata(site);
    else {
      const found = await wikidata(null);
      const web = found?.find((x) => x.field === 'website');
      site = web ? logoDomain(String(web.value)) : null;
    }
    let reached = false;
    if (site) {
      let home: Page | null = null;
      for (const start of [`https://${site}/`, `https://www.${site}/`]) {
        home = await net.page(start).catch(() => null);
        if (home) break;
      }
      if (home) {
        reached = true;
        sources.push({ url: home.url, kind: 'WEBSITE' });
        const links = pagesToRead(home, site);
        const extra = (await Promise.all([links.about, links.contact, links.offices].filter((u): u is string => !!u && u !== home.url).map((u) => net.page(u).catch(() => null)))).filter((p): p is Page => !!p);
        for (const p of extra) sources.push({ url: p.url, kind: 'WEBSITE' });
        const contactPage = extra.find((p) => p.url === links.contact)?.url ?? links.contact;
        candidates.push(...readWebsite([home, ...extra], site, contactPage));
      } else {
        error = `Could not reach ${site}`;
      }
    }
    await wiki;
    if (sources.some((s) => s.kind === 'WIKIDATA')) reached = true;
    if (!site && !candidates.length) error = 'No website, and Wikidata has no company with exactly this name.';
    return { candidates, sources, reached, error };
  }

  private async apply(c: { id: string; tenantId: string; companyId: string }, collected: Collected, attempts: number): Promise<void> {
    await this.prisma.run({ tenantId: c.tenantId }, async (tx) => {
      const run = await tx.companyEnrichment.findFirst({ where: { id: c.id, status: 'PENDING' }, select: { id: true } });
      if (!run) return;
      const company = await tx.company.findFirst({ where: { id: c.companyId, tenantId: c.tenantId, deletedAt: null } });
      if (!company) return;
      const result = merge(company as unknown as CompanyNow, collected.candidates, c.id, new Date());
      if (result.fills.length) {
        await tx.company.update({ where: { id: company.id }, data: { ...(result.data as Prisma.CompanyUncheckedUpdateInput), fieldSources: result.fieldSources as unknown as Prisma.InputJsonValue } });
        if (result.data.website && !company.domain) await this.logos.domainChangedIn(tx, c.tenantId, company.id, String(result.data.domain ?? ''));
        await this.audit.record(tx, {
          tenantId: c.tenantId, actorUserId: null, action: 'company.auto_filled', entityType: 'company', entityId: company.id,
          metadata: { runId: c.id, fields: result.fills.map((f) => f.field), sources: [...new Set(result.fills.map((f) => f.source))] },
        });
      }
      const status: EnrichmentStatus = result.fills.length ? 'DONE' : 'NOTHING_FOUND';
      await tx.companyEnrichment.update({
        where: { id: c.id },
        data: { status, attempts, fills: result.fills as unknown as Prisma.InputJsonValue, sources: collected.sources as unknown as Prisma.InputJsonValue, error: collected.error, finishedAt: new Date(), nextRunAt: null },
      });
    });
  }

  private async finish(c: { id: string; tenantId: string }, status: EnrichmentStatus, fills: StoredFill[], sources: Collected['sources'], error: string | null): Promise<void> {
    await this.prisma.run({ tenantId: c.tenantId }, (tx) =>
      tx.companyEnrichment.updateMany({
        where: { id: c.id, status: 'PENDING' },
        data: { status, fills: fills as unknown as Prisma.InputJsonValue, sources: sources as unknown as Prisma.InputJsonValue, error: error?.slice(0, 500) ?? null, finishedAt: new Date(), nextRunAt: null },
      }),
    );
  }
}

function toRun(r: Prisma.CompanyEnrichmentGetPayload<object>, by: { id: string; name: string } | null): EnrichmentRun {
  const fills = (Array.isArray(r.fills) ? r.fills : []) as unknown as StoredFill[];
  return {
    id: r.id,
    status: r.status as EnrichmentStatus,
    trigger: r.trigger as EnrichmentTrigger,
    domain: r.domain,
    requestedBy: by,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    fills: fills.map((f) => ({ field: f.field, display: f.display, source: f.source, url: f.url, confidence: f.confidence, undone: f.undone })),
    sources: (Array.isArray(r.sources) ? r.sources : []) as EnrichmentRun['sources'],
    error: r.error,
  };
}

/** Field sources as the app shows them: without the internal item keys. */
export function publicSources(raw: unknown): Partial<Record<EnrichField, FieldSource>> {
  const all = sourcesOf(raw);
  const out: Partial<Record<EnrichField, FieldSource>> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!(ENRICH_FIELDS as readonly string[]).includes(k)) continue;
    const { rejected: _r, ...rest } = v;
    out[k as EnrichField] = rest;
  }
  return out;
}
