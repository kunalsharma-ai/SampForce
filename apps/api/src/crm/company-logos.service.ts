import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { CompanyLogoRef } from '@dealflow/types';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { publicFetch } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { claimDue, errorMessage } from '../worker/queue';
import { findLogo, LOGO_MAX_BYTES, LOGO_MIN_WIDTH, type LogoFetcher, logoDomain, sniffImage } from './company-logo-finder';
import { notFound } from './crm-helpers';
import { canSeeDetails, companyScope, visibility } from './visibility';

const TIMEOUT_MS = 6000;
const PAGE_MAX_BYTES = 600_000;
const LOOKUP_DEADLINE_MS = 25_000;
const BATCH = 6;
/** Look-ups that could not reach the site are tried again after these waits, then given up (FAILED). */
const RETRY_AFTER_MS = [5 * 60_000, 60 * 60_000, 24 * 60 * 60_000];
/** A claimed look-up that never finished (the worker stopped) becomes due again after this. */
const LEASE_MS = 5 * 60_000;
export const LOGO_USER_AGENT = 'SampForceBot/1.0 (company logo; reads the site icon only)';

type Status = CompanyLogoRef['status'];
type LogoMeta = { companyId: string; source: string; status: string; width: number | null; updatedAt: Date; contentType: string | null };

/**
 * Company logos (ADR 0070). A company with a website gets its logo found automatically by the worker; anyone who
 * may edit the company can upload one instead, which is never replaced automatically. Rows carry only a small
 * reference; the image is served from GET /companies/:id/logo.
 */
@Injectable()
export class CompanyLogosService {
  private readonly log = new Logger(CompanyLogosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Called inside a company create or update when its domain may have changed: queues a look-up for the new domain,
   * or drops the automatic logo when the website was removed. Uploaded logos are left alone.
   */
  async domainChangedIn(tx: TenantTx, tenantId: string, companyId: string, rawDomain: string | null | undefined): Promise<void> {
    const domain = logoDomain(rawDomain);
    const existing = await tx.companyLogo.findFirst({ where: { tenantId, companyId }, select: { id: true, source: true, domain: true } });
    if (existing?.source === 'UPLOAD') return;
    if (!domain) {
      if (existing) await tx.companyLogo.delete({ where: { id: existing.id } });
      return;
    }
    if (existing?.domain === domain) return;
    await this.queueIn(tx, tenantId, companyId, domain, existing?.id ?? null);
  }

  private async queueIn(tx: TenantTx, tenantId: string, companyId: string, domain: string, existingId: string | null): Promise<void> {
    const data = { source: 'AUTO', status: 'PENDING', domain, contentType: null, data: null, sizeBytes: null, width: null, sourceUrl: null, attempts: 0, nextRunAt: new Date(), lastError: null, uploadedById: null };
    if (existingId) await tx.companyLogo.update({ where: { id: existingId }, data });
    else await tx.companyLogo.create({ data: { ...data, tenantId, companyId } });
  }

  /** Logo references for a page of company rows (no image bytes). */
  async refsIn(tx: TenantTx, tenantId: string, companyIds: string[]): Promise<Map<string, CompanyLogoRef>> {
    if (!companyIds.length) return new Map();
    const rows: LogoMeta[] = await tx.companyLogo.findMany({
      where: { tenantId, companyId: { in: companyIds } },
      select: { companyId: true, source: true, status: true, width: true, updatedAt: true, contentType: true },
    });
    return new Map(rows.map((r) => [r.companyId, toRef(r)]));
  }

  /**
   * Companies that have a website but were never looked up (created before logos existed, or by an import that
   * wrote documents directly) are queued after the response, outside the request's transaction.
   */
  backfill(tenantId: string, companies: { id: string; domain: string | null }[], known: Map<string, CompanyLogoRef>): void {
    const missing = companies.filter((c) => !known.has(c.id) && logoDomain(c.domain));
    if (!missing.length) return;
    void this.prisma
      .run({ tenantId }, async (tx) => {
        const have = new Set((await tx.companyLogo.findMany({ where: { tenantId, companyId: { in: missing.map((c) => c.id) } }, select: { companyId: true } })).map((r) => r.companyId));
        for (const c of missing) if (!have.has(c.id)) await this.queueIn(tx, tenantId, c.id, logoDomain(c.domain)!, null);
      })
      .catch((err) => this.log.warn({ err: errorMessage(err), tenantId }, 'logo backfill skipped'));
  }

  /** The image, for GET /companies/:id/logo. Anyone who can see the company can see its logo. */
  image(auth: AuthContext, companyId: string): Promise<{ contentType: string; data: Buffer }> {
    return this.prisma.run(auth, async (tx) => {
      await this.visibleCompany(tx, auth, companyId);
      const logo = await tx.companyLogo.findFirst({ where: { tenantId: auth.tenantId, companyId, status: 'FOUND' }, select: { contentType: true, data: true } });
      if (!logo?.data || !logo.contentType) throw notFound('Logo');
      return { contentType: logo.contentType, data: Buffer.from(logo.data) };
    });
  }

  /** Uploads a logo. The image type is read from its bytes, never trusted from the request. */
  upload(auth: AuthContext, companyId: string, data: Buffer, meta: RequestMeta): Promise<CompanyLogoRef> {
    const img = data.length <= LOGO_MAX_BYTES ? sniffImage(data) : null;
    if (data.length > LOGO_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Logos can be up to 1 MB.' });
    if (!img) throw new BadRequestException({ code: 'INVALID_IMAGE', message: 'Use a PNG, JPEG, WebP, GIF, ICO or SVG image.' });
    if (img.width !== null && img.width < LOGO_MIN_WIDTH) throw new BadRequestException({ code: 'IMAGE_TOO_SMALL', message: 'The image is too small. Use one at least 16 pixels wide.' });
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, companyId);
      const fields = { source: 'UPLOAD', status: 'FOUND', contentType: img.contentType, data: new Uint8Array(data), sizeBytes: data.length, width: img.width, sourceUrl: null, attempts: 0, nextRunAt: null, lastError: null, uploadedById: auth.userId, domain: logoDomain(company.domain) };
      const existing = await tx.companyLogo.findFirst({ where: { tenantId: auth.tenantId, companyId }, select: { id: true } });
      const row = existing
        ? await tx.companyLogo.update({ where: { id: existing.id }, data: fields })
        : await tx.companyLogo.create({ data: { ...fields, tenantId: auth.tenantId, companyId } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.logo_uploaded', entityType: 'company', entityId: companyId,
        metadata: { contentType: img.contentType, sizeBytes: data.length }, meta,
      });
      return toRef(row);
    });
  }

  /** Removes an uploaded logo; a company with a website goes back to its automatic logo (looked up again). */
  remove(auth: AuthContext, companyId: string, meta: RequestMeta): Promise<CompanyLogoRef | null> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, companyId);
      const existing = await tx.companyLogo.findFirst({ where: { tenantId: auth.tenantId, companyId }, select: { id: true, source: true } });
      if (!existing) return null;
      const domain = logoDomain(company.domain);
      if (domain) await this.queueIn(tx, auth.tenantId, companyId, domain, existing.id);
      else await tx.companyLogo.delete({ where: { id: existing.id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'company.logo_removed', entityType: 'company', entityId: companyId,
        metadata: { source: existing.source }, meta,
      });
      return (await this.refsIn(tx, auth.tenantId, [companyId])).get(companyId) ?? null;
    });
  }

  /** Looks the automatic logo up again (a site that changed its icon, or one that was unreachable). */
  refresh(auth: AuthContext, companyId: string): Promise<CompanyLogoRef> {
    return this.prisma.run(auth, async (tx) => {
      const company = await this.editableCompany(tx, auth, companyId);
      const existing = await tx.companyLogo.findFirst({ where: { tenantId: auth.tenantId, companyId }, select: { id: true, source: true } });
      if (existing?.source === 'UPLOAD') {
        throw new ConflictException({ code: 'LOGO_UPLOADED', message: 'This logo was uploaded. Remove it to find one from the website again.' });
      }
      const domain = logoDomain(company.domain);
      if (!domain) throw new BadRequestException({ code: 'NO_WEBSITE', message: 'Add the company’s website first.' });
      await this.queueIn(tx, auth.tenantId, companyId, domain, existing?.id ?? null);
      return (await this.refsIn(tx, auth.tenantId, [companyId])).get(companyId)!;
    });
  }

  private async visibleCompany(tx: TenantTx, auth: AuthContext, id: string) {
    const v = await visibility(tx, auth);
    const company = await tx.company.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) }, select: { id: true, ownerId: true, domain: true } });
    if (!company) throw notFound('Company');
    return { company, v };
  }

  private async editableCompany(tx: TenantTx, auth: AuthContext, id: string) {
    const { company, v } = await this.visibleCompany(tx, auth, id);
    if (!canSeeDetails(v, company.ownerId)) throw new ForbiddenException({ code: 'DETAILS_HIDDEN', message: 'Your role cannot see or change the details of this company.' });
    return company;
  }

  private inFlight: Promise<unknown> | null = null;

  /**
   * Worker: claims a few due logos and looks them up in parallel, each with its own deadline. The look-ups run in the
   * background so a slow website never holds up the other queues of the tick; the next batch is claimed once this one
   * has finished. `wait` (tests, shutdown) waits for the batch.
   */
  async runDue(now = new Date(), wait = false): Promise<number> {
    if (this.inFlight) {
      if (wait) await this.inFlight;
      else return 0;
    }
    const claimed = await claimDue<{ id: string; tenantId: string; companyId: string; domain: string | null; attempts: number }>(this.prisma.companyLogo, {
      where: { status: 'PENDING', source: 'AUTO', nextRunAt: { lte: now } },
      lease: { nextRunAt: new Date(now.getTime() + LEASE_MS) },
      select: { tenantId: true, companyId: true, domain: true, attempts: true },
      orderBy: { nextRunAt: 'asc' },
      limit: BATCH,
    });
    if (!claimed.length) return 0;
    const batch = Promise.all(claimed.map((c) => this.lookUp(c))).finally(() => {
      if (this.inFlight === batch) this.inFlight = null;
    });
    this.inFlight = batch;
    if (wait) await batch;
    return claimed.length;
  }

  /** Waits for look-ups that are still running (worker shutdown). */
  async settle(): Promise<void> {
    await this.inFlight;
  }

  private async lookUp(c: { id: string; tenantId: string; domain: string | null; attempts: number }): Promise<void> {
    if (!c.domain) return;
    const result = await Promise.race([
      findLogo(c.domain, this.fetcher()).catch((err: unknown) => ({ status: 'UNREACHABLE' as const, error: errorMessage(err) })),
      new Promise<{ status: 'UNREACHABLE'; error: string }>((resolve) => setTimeout(() => resolve({ status: 'UNREACHABLE', error: 'Timed out' }), LOOKUP_DEADLINE_MS).unref()),
    ]);
    const attempts = c.attempts + 1;
    let data: Record<string, unknown>;
    let status: Status;
    if (result.status === 'FOUND') {
      status = 'FOUND';
      data = { contentType: result.logo.contentType, data: new Uint8Array(result.logo.data), sizeBytes: result.logo.data.length, width: result.logo.width, sourceUrl: result.logo.sourceUrl, lastError: null };
    } else if (result.status === 'NOT_FOUND') {
      status = 'NOT_FOUND';
      data = { lastError: null };
    } else {
      const wait = RETRY_AFTER_MS[attempts - 1];
      status = wait ? 'PENDING' : 'FAILED';
      data = { lastError: result.error.slice(0, 500), ...(wait ? { nextRunAt: new Date(Date.now() + wait) } : {}) };
    }
    try {
      // Only if nothing changed meanwhile: same domain, still automatic and still waiting for this look-up.
      await this.prisma.run({ tenantId: c.tenantId }, (tx) =>
        tx.companyLogo.updateMany({
          where: { id: c.id, tenantId: c.tenantId, domain: c.domain, source: 'AUTO', status: 'PENDING' },
          data: { ...data, status, attempts, ...(status === 'PENDING' ? {} : { nextRunAt: null }) },
        }),
      );
    } catch (err) {
      this.log.error({ err: errorMessage(err), tenantId: c.tenantId }, 'saving a company logo failed');
    }
  }

  /** The look-up's only way out: public https addresses, every redirect checked, sizes and times capped. */
  private fetcher(): LogoFetcher {
    const fx = this.env.LOGO_FIXTURE_URL;
    const get = async (url: string, accept: string): Promise<{ res: Response; url: string } | null> => {
      let target = url;
      for (let hop = 0; hop < 5; hop++) {
        const u = new URL(target);
        let res: Response;
        try {
          const init = { redirect: 'manual' as const, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': LOGO_USER_AGENT, accept } };
          res = fx ? await fetch(`${fx}/site/${u.host}${u.pathname}${u.search}`, init) : await publicFetch(target, init, false);
        } catch {
          return null;
        }
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => undefined);
          target = new URL(location, target).toString();
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          return null;
        }
        return { res, url: target };
      }
      return null;
    };
    return {
      page: async (url) => {
        const got = await get(url, 'text/html');
        if (!got) return null;
        if (!/text\/html|application\/xhtml/i.test(got.res.headers.get('content-type') ?? '')) {
          await got.res.body?.cancel().catch(() => undefined);
          return null;
        }
        const body = await readCapped(got.res, PAGE_MAX_BYTES, true);
        return body ? { url: got.url, html: body.toString('utf8') } : null;
      },
      file: async (url) => {
        const got = await get(url, 'image/*');
        return got ? readCapped(got.res, LOGO_MAX_BYTES, false) : null;
      },
    };
  }
}

/** Reads at most `max` bytes. A page is cut there (its head is what matters); a file that is too big is dropped. */
async function readCapped(res: Response, max: number, truncate: boolean): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const declared = Number(res.headers.get('content-length'));
  if (!truncate && Number.isFinite(declared) && declared > max) {
    await res.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        if (!truncate) return null;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

function toRef(r: LogoMeta): CompanyLogoRef {
  const found = r.status === 'FOUND' && !!r.contentType;
  return {
    url: found ? `/api/v1/companies/${r.companyId}/logo?v=${r.updatedAt.getTime().toString(36)}` : null,
    source: r.source === 'UPLOAD' ? 'UPLOAD' : 'AUTO',
    status: (['PENDING', 'FOUND', 'NOT_FOUND', 'FAILED'] as const).find((s) => s === r.status) ?? 'PENDING',
    width: r.width,
  };
}

/** Reads a raw logo upload (the image is the request body), refusing anything over 1 MB as it streams in. */
export async function readLogoUpload(req: Request): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Logos can be up to 1 MB.' });
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > LOGO_MAX_BYTES) throw tooBig();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
