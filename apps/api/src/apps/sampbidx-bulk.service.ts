import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type AppConnection, Prisma, type SampbidxBatch } from '@dealflow/database';
import {
  SAMPBIDX_BATCH_MAX,
  SAMPBIDX_CHECK_STEPS,
  type SampbidxBatchCompletion,
  type SampbidxBatchItem,
  type SampbidxBatchKind,
  type SampbidxBatchRow,
  type SampbidxBulkFix,
  type SampbidxBulkPreview,
  type SampbidxBulkPreviewItem,
  type SampbidxCheckStep,
  type SampbidxCheckStepKey,
  type SampbidxDiagnosis,
  type SampbidxDiagnoseInput,
  type SampbidxOverview,
  type SampbidxSettings,
  type SampbidxTransferKind,
  type sampbidxBatchInputSchema,
  type z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { canSeeDetails, companyScope, dealScope, personRefs, visibility } from '../crm/visibility';
import { missingContactFields, previewContact } from './sampbidx-company';
import { SampbidxClient, SampbidxError } from './sampbidx';
import { NotificationsService } from '../notifications/notifications.service';
import { SampbidxService } from './sampbidx.service';

type BatchInput = z.output<typeof sampbidxBatchInputSchema>;

/** A batch whose runner has not written for this long was interrupted (a restart) and is picked up again. */
const STALE_BATCH_MS = 2 * 60_000;
/** "Test connection" waits this long for SampBidx's answer, so a silent address fails quickly. */
const CHECK_TIMEOUT_MS = 15_000;

const FIELD_LABEL: Record<SampbidxBulkFix['field'], string> = { email: 'email', country: 'country', timeZone: 'time zone', amount: 'amount' };

interface Plan {
  item: SampbidxBulkPreviewItem;
  /** Employees to send as the client's contacts (the first is the main one). */
  contactIds: string[];
  companyId: string | null;
}

/**
 * Many deals or won companies to SampBidx in one go (ADR 0099), plus the SampBidx settings page: "Test connection"
 * step by step, the connection's real state, sync counts and the error log.
 *
 * A bulk send is checked first (preview): each record is ready, needs a detail typed in, or is skipped with the
 * reason. What the person types is saved to the SampForce records (audited). The batch then runs in the background
 * one record at a time, through the same transfers as a single send: the company goes as the SampBidx client first
 * when SampBidx does not have it or it changed, then the deal. Each transfer's id is its Idempotency-Key and each
 * record's SampForce id is its externalId, so a retry or a second batch updates the same SampBidx record. An item
 * counts as sent only when SampBidx answered with its id.
 */
@Injectable()
export class SampbidxBulkService {
  private readonly log = new Logger('SampbidxBulk');
  /** Batches this process is running now, so a page refresh never starts a second runner. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sampbidx: SampbidxService,
    private readonly client: SampbidxClient,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Check before sending ───

  async preview(auth: AuthContext, input: BatchInput): Promise<SampbidxBulkPreview> {
    const plans = await this.plan(auth, input);
    const items = plans.map((p) => p.item);
    let connectionProblem: string | null = null;
    try {
      await this.sampbidx.usableConnection(auth.tenantId);
    } catch (e) {
      connectionProblem = errorText(e);
    }
    return {
      kind: input.kind,
      items,
      counts: { ready: items.filter((i) => i.status === 'READY').length, needsFix: items.filter((i) => i.status === 'NEEDS_FIX').length, skip: items.filter((i) => i.status === 'SKIP').length },
      connectionProblem,
    };
  }

  /** Saves the typed details, then sends every ready record in the background. Items still missing details are skipped, with the reason. */
  async start(auth: AuthContext, input: BatchInput, meta: RequestMeta): Promise<SampbidxBatchRow> {
    await this.sampbidx.usableConnection(auth.tenantId);
    if (input.completion) await this.saveCompletion(auth, input.kind, input.completion, meta);
    const plans = await this.plan(auth, input);
    if (!plans.length) throw new BadRequestException({ code: 'NOTHING_TO_SEND', message: 'None of the chosen records can be sent.' });
    const items: (SampbidxBatchItem & { contactIds: string[] })[] = plans.map((p) => ({
      recordId: p.item.recordId,
      label: p.item.label,
      sub: p.item.sub,
      outcome: p.item.status === 'READY' ? 'PENDING' : 'SKIPPED',
      reason: p.item.status === 'READY' ? null : p.item.status === 'NEEDS_FIX' ? `Needs correction: ${p.item.reason}` : p.item.reason,
      warnings: p.item.warnings,
      remoteId: null,
      remoteUrl: null,
      transferIds: [],
      contactIds: p.contactIds,
    }));
    const batch = await this.prisma.run(auth, async (tx) => {
      const b = await tx.sampbidxBatch.create({
        data: { tenantId: auth.tenantId, kind: input.kind, resend: input.resend, items: items as unknown as Prisma.InputJsonValue, createdById: auth.userId, status: items.some((i) => i.outcome === 'PENDING') ? 'RUNNING' : 'DONE', finishedAt: items.some((i) => i.outcome === 'PENDING') ? null : new Date() },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'sampbidx.bulk_started',
        entityType: 'sampbidx_batch',
        entityId: b.id,
        metadata: { kind: input.kind, total: items.length, pending: items.filter((i) => i.outcome === 'PENDING').length, resend: input.resend },
        meta,
      });
      return b;
    });
    this.kick(auth, batch.id);
    return this.row(auth, batch);
  }

  async get(auth: AuthContext, id: string): Promise<SampbidxBatchRow> {
    const b = await this.find(auth, id);
    // A runner that stopped (the server restarted) is picked up again where it was.
    if (b.status === 'RUNNING' && !this.running.has(b.id) && Date.now() - b.updatedAt.getTime() > STALE_BATCH_MS) this.kick(auth, b.id);
    return this.row(auth, b);
  }

  async list(auth: AuthContext, limit = 10): Promise<SampbidxBatchRow[]> {
    const rows = await this.prisma.run(auth, (tx) => tx.sampbidxBatch.findMany({ where: { tenantId: auth.tenantId, ...(this.canSeeAll(auth) ? {} : { createdById: auth.userId }) }, orderBy: { createdAt: 'desc' }, take: limit }));
    return Promise.all(rows.map((b) => this.row(auth, b)));
  }

  /** Sends the failed items of a batch again. Their transfers keep their Idempotency-Key, so SampBidx never makes a record twice. */
  async retry(auth: AuthContext, id: string, meta: RequestMeta): Promise<SampbidxBatchRow> {
    await this.sampbidx.usableConnection(auth.tenantId);
    const b = await this.find(auth, id);
    if (b.status === 'RUNNING' && (this.running.has(b.id) || Date.now() - b.updatedAt.getTime() <= STALE_BATCH_MS)) throw new ConflictException({ code: 'IN_PROGRESS', message: 'This batch is still being sent.' });
    const items = itemsOf(b);
    const failed = items.filter((i) => i.outcome === 'FAILED' || i.outcome === 'SENDING');
    if (!failed.length) throw new ConflictException({ code: 'NOTHING_FAILED', message: 'Nothing in this batch failed.' });
    for (const i of failed) Object.assign(i, { outcome: 'PENDING', reason: null });
    const saved = await this.prisma.run(auth, async (tx) => {
      const u = await tx.sampbidxBatch.update({ where: { id: b.id }, data: { items: items as unknown as Prisma.InputJsonValue, status: 'RUNNING', finishedAt: null } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sampbidx.bulk_retried', entityType: 'sampbidx_batch', entityId: b.id, metadata: { items: failed.length }, meta });
      return u;
    });
    this.kick(auth, b.id);
    return this.row(auth, saved);
  }

  // ─── Settings page ───

  /**
   * "Test connection", one step at a time: the address, whether SampForce may call it, whether anything answers,
   * whether SampBidx's API is there, whether the key is accepted, and whether SampBidx has sent a status update yet.
   * With nothing typed it tests the saved connection and records the result on it; typed-in values are never saved.
   */
  async diagnose(auth: AuthContext, input: SampbidxDiagnoseInput): Promise<SampbidxDiagnosis> {
    const conn = await this.connection(auth.tenantId);
    const savedKeys = conn ? this.sampbidx.keys(conn) : null;
    const saved = !input.baseUrl && !input.apiKey;
    const baseUrl = (input.baseUrl || savedKeys?.baseUrl || '').replace(/\/+$/, '');
    const apiKey = input.apiKey || savedKeys?.apiKey || '';
    const steps = new Map<SampbidxCheckStepKey, SampbidxCheckStep>(SAMPBIDX_CHECK_STEPS.map((key) => [key, { key, ok: null, message: '', hint: null }]));
    const set = (key: SampbidxCheckStepKey, ok: boolean | null, message: string, hint: string | null = null) => steps.set(key, { key, ok, message, hint });
    let accountName: string | null = null;
    let latencyMs: number | null = null;
    let failure: string | null = null;

    const url = parseUrl(baseUrl);
    if (!baseUrl) failure = 'No SampBidx address is saved or typed in.';
    else if (!url) failure = `“${baseUrl}” is not a web address.`;
    else if (!apiKey) failure = 'No API key is saved or typed in.';
    if (failure) set('address', false, failure, 'Type the API address SampBidx gave you (for example https://sampbidx.example.com/api) and the API key from SampBidx.');
    else {
      set('address', true, `${url!.protocol}//${url!.host}${url!.pathname === '/' ? '' : url!.pathname}`);
      const started = Date.now();
      try {
        const r = await this.client.check({ baseUrl, apiKey }, CHECK_TIMEOUT_MS);
        latencyMs = Date.now() - started;
        accountName = r.accountName;
        set('network', true, url!.protocol === 'https:' ? 'SampForce may call this address.' : 'An approved private address: plain http is allowed.');
        set('reachable', true, `SampBidx answered in ${latencyMs} ms.`);
        set('api', true, 'GET /v1/ping is there.');
        set('key', true, `The key is accepted for ${accountName}.`);
      } catch (e) {
        if (!(e instanceof SampbidxError)) throw e;
        failure = e.message;
        const host = url!.hostname;
        if (e.code === 'address') {
          set(
            'network',
            false,
            e.message,
            url!.protocol === 'http:'
              ? `Use https:// for a public address. If SampBidx runs on your own server or network, a SampForce operator must add ${host} under Console → Providers → Workspace servers → Approved private hosts.`
              : `If SampBidx runs on the same server or your own network, a SampForce operator must add ${host} (or its network, for example 172.16.0.0/12 for Docker) under Console → Providers → Workspace servers → Approved private hosts.`,
          );
        } else {
          set('network', true, 'SampForce may call this address.');
          if (e.code === 'unavailable') {
            set('reachable', false, `Nothing answered: ${e.detail ?? 'network error'}.`, 'Check that SampBidx is running at this address and port, and that the SampForce server can reach it (firewall, DNS, Docker network). From inside Docker, “localhost” is the SampForce container itself: use SampBidx’s container name or server address.');
          } else {
            set('reachable', true, `SampBidx answered in ${Date.now() - started} ms.`);
            if (e.code === 'not_found') set('api', false, 'Something answered, but not SampBidx’s SampForce API: GET /v1/ping returned 404.', 'Check the address ends where the /v1 paths begin (often …/api). If it does, SampBidx has not built the SampForce API yet: send the SampBidx team docs/integrations/sampbidx-api.md.');
            else if (e.code === 'auth') {
              set('api', true, 'GET /v1/ping is there.');
              set('key', false, e.message, 'Create a new API key in SampBidx (Settings → API keys) and paste it here.');
            } else set('api', false, e.message, 'SampBidx answered with an error. Try again shortly; if it stays, ask the SampBidx team to check their API logs.');
          }
        }
      }
    }
    const lastCallbackAt = (conn?.settings as Partial<SampbidxSettings> | undefined)?.lastCallbackAt ?? null;
    if (!failure) {
      if (!conn || (saved ? false : baseUrl !== savedKeys?.baseUrl)) set('callback', null, 'Status updates can be checked once this address is saved.', 'Save the address, then give SampBidx the callback URL and secret shown on this page.');
      else if (lastCallbackAt) set('callback', true, `SampBidx last sent a signed status update on ${lastCallbackAt.slice(0, 10)}.`);
      else set('callback', null, 'SampBidx has not sent a signed status update yet. Sending works without it, but bid progress will not show in SampForce.', 'Give SampBidx the callback URL and secret shown on this page.');
    }
    const checkedAt = new Date();
    // A connection prepared for SampBidx's callback form but never saved with a key stays not connected.
    if (saved && conn && conn.status !== 'DISCONNECTED') {
      // The saved connection's state is the test's real answer, never assumed.
      const settings = { ...(conn.settings as object), lastCheck: { at: checkedAt.toISOString(), ok: !failure, message: failure } };
      await this.prisma.run({ tenantId: auth.tenantId }, (tx) =>
        tx.appConnection.update({
          where: { id: conn.id },
          data: failure ? { status: 'ERROR', lastError: failure, settings: settings as Prisma.InputJsonValue } : { status: 'CONNECTED', lastError: null, ...(accountName ? { accountName } : {}), settings: settings as Prisma.InputJsonValue },
        }),
      );
    }
    return { ok: !failure, steps: [...steps.values()], accountName, latencyMs, checkedAt: checkedAt.toISOString(), saved: saved && !!conn && conn.status !== 'DISCONNECTED' };
  }

  /** The settings page: the saved connection as it really is, what has been synced, the recent errors and bulk sends. */
  async overview(auth: AuthContext): Promise<SampbidxOverview> {
    const conn = await this.connection(auth.tenantId);
    const settings = (conn?.settings ?? {}) as Partial<SampbidxSettings>;
    const keys = conn ? this.sampbidx.keys(conn) : null;
    // A row made only for the callback URL and secret (before a key) is "not connected": no account, no connected by.
    const live = !!conn && conn.status !== 'DISCONNECTED';
    const [counts, last, errors, connectedBy] = await this.prisma.run(auth, async (tx) =>
      Promise.all([
        tx.sampbidxTransfer.groupBy({ by: ['kind', 'delivery'], where: { tenantId: auth.tenantId }, _count: { _all: true } }),
        tx.sampbidxTransfer.groupBy({ by: ['kind'], where: { tenantId: auth.tenantId, delivery: 'SENT' }, _max: { sentAt: true } }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: auth.tenantId, delivery: 'FAILED' }, orderBy: { updatedAt: 'desc' }, take: 20, omit: { emailFileData: true } }).then((rows) => this.sampbidx.rows(tx, auth.tenantId, rows)),
        live && conn?.connectedById ? personRefs(tx, auth.tenantId, [conn.connectedById]).then((m) => m.get(conn.connectedById!)?.name ?? null) : Promise.resolve(null),
      ]),
    );
    const kinds = [...new Set(counts.map((c) => c.kind))] as SampbidxTransferKind[];
    const n = (kind: string, delivery: string) => counts.find((c) => c.kind === kind && c.delivery === delivery)?._count._all ?? 0;
    return {
      state: !conn || conn.status === 'DISCONNECTED' ? 'NOT_CONNECTED' : conn.status === 'ERROR' ? 'ERROR' : 'CONNECTED',
      baseUrl: keys?.baseUrl || null,
      accountName: live ? (conn?.accountName ?? null) : null,
      keyHint: keys?.apiKey ? `…${keys.apiKey.slice(-4)}` : null,
      connectedAt: live ? (conn?.createdAt.toISOString() ?? null) : null,
      connectedBy,
      lastCheckedAt: settings.lastCheck?.at ?? null,
      lastError: conn?.status === 'ERROR' ? conn.lastError : null,
      callbackUrl: settings.callbackUrl ?? null,
      lastCallbackAt: settings.lastCallbackAt ?? null,
      sync: kinds.map((kind) => ({ kind, sent: n(kind, 'SENT'), failed: n(kind, 'FAILED'), sending: n(kind, 'SENDING'), lastSentAt: last.find((l) => l.kind === kind)?._max.sentAt?.toISOString() ?? null })),
      errors,
      batches: await this.list(auth, 10),
      canManage: auth.permissions.includes('integrations:manage'),
    };
  }

  // ─── Planning ───

  private async plan(auth: AuthContext, input: BatchInput): Promise<Plan[]> {
    return input.kind === 'DEALS' ? this.planDeals(auth, input.ids, input.resend) : this.planCompanies(auth, input.ids, input.allWon, input.resend);
  }

  private async planDeals(auth: AuthContext, ids: string[], resend: boolean): Promise<Plan[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const unique = [...new Set(ids)];
      const deals = await tx.opportunity.findMany({ where: { tenantId: auth.tenantId, id: { in: unique }, deletedAt: null, ...dealScope(v) }, include: { company: true, contact: true } });
      const companyIds = [...new Set(deals.map((d) => d.companyId).filter((x): x is string => !!x))];
      const [links, sent, busy] = await Promise.all([
        tx.sampbidxClient.findMany({ where: { tenantId: auth.tenantId, companyId: { in: companyIds } } }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: auth.tenantId, kind: 'DEAL', dealId: { in: unique }, delivery: 'SENT' }, select: { dealId: true, sentAt: true }, orderBy: { sentAt: 'desc' } }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: auth.tenantId, kind: 'DEAL', dealId: { in: unique }, delivery: 'SENDING', updatedAt: { gt: new Date(Date.now() - 2 * 60_000) } }, select: { dealId: true } }),
      ]);
      return unique.map((id): Plan => {
        const d = deals.find((x) => x.id === id);
        const base = { recordId: id, warnings: [] as string[], fixes: [] as SampbidxBulkFix[], inSampbidx: false };
        if (!d) return { item: { ...base, label: 'Deal', sub: null, status: 'SKIP', reason: 'Not found, or not visible to you.' }, contactIds: [], companyId: null };
        const label = d.name;
        const sub = [d.dealNumber, d.company?.name].filter(Boolean).join(' · ') || null;
        const lastSent = sent.find((s) => s.dealId === id)?.sentAt ?? null;
        const item: SampbidxBulkPreviewItem = { ...base, label, sub, status: 'READY', reason: null, inSampbidx: !!lastSent };
        const skip = (reason: string): Plan => ({ item: { ...item, status: 'SKIP', reason }, contactIds: [], companyId: d.companyId });
        if (!d.company || d.company.deletedAt) return skip('The deal has no company, so SampBidx would not know the client. Add the company to the deal first.');
        if (!canSeeDetails(v, d.company.ownerId)) return skip('Your role cannot see the details of this deal’s company.');
        if (busy.some((b) => b.dealId === id)) return skip('It is being sent right now.');
        const link = links.find((l) => l.companyId === d.companyId);
        const unchanged = lastSent && d.updatedAt <= lastSent && (!link || d.company.updatedAt <= synced(link)) && (!d.contact || d.contact.updatedAt <= lastSent);
        if (unchanged && !resend) return skip(`Already in SampBidx and unchanged since ${lastSent!.toISOString().slice(0, 10)}. Tick “Send again” to send it anyway.`);
        if (!(d.amount > 0)) item.fixes.push({ record: 'deal', recordId: d.id, recordLabel: d.name, field: 'amount' });
        if (d.contact && !d.contact.deletedAt) {
          const p = previewContact(d.contact, d.company, null);
          for (const f of missingContactFields(p)) if (f !== 'name') item.fixes.push({ record: 'contact', recordId: d.contact.id, recordLabel: p.name.value as string, field: f });
        } else item.warnings.push('The deal has no contact, so the client goes without one.');
        if (item.fixes.length) Object.assign(item, { status: 'NEEDS_FIX', reason: `Missing ${item.fixes.map((f) => `${f.record === 'deal' ? 'the deal' : f.recordLabel}’s ${FIELD_LABEL[f.field]}`).join(', ')}.` });
        return { item, contactIds: d.contact && !d.contact.deletedAt ? [d.contact.id] : [], companyId: d.companyId };
      });
    });
  }

  private async planCompanies(auth: AuthContext, ids: string[], allWon: boolean, resend: boolean): Promise<Plan[]> {
    return this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      const where: Prisma.CompanyWhereInput = { tenantId: auth.tenantId, deletedAt: null, ...companyScope(v) };
      const companies = allWon
        ? await tx.company.findMany({ where: { ...where, wonAt: { not: null } }, orderBy: { wonAt: 'desc' }, take: SAMPBIDX_BATCH_MAX })
        : await tx.company.findMany({ where: { ...where, id: { in: [...new Set(ids)] } } });
      const order = allWon ? companies.map((c) => c.id) : [...new Set(ids)];
      const cids = companies.map((c) => c.id);
      const wonDealIds = companies.map((c) => c.wonDealId).filter((x): x is string => !!x);
      const [links, wonDeals, contributors, rfqContacts, busy] = await Promise.all([
        tx.sampbidxClient.findMany({ where: { tenantId: auth.tenantId, companyId: { in: cids } } }),
        tx.opportunity.findMany({ where: { tenantId: auth.tenantId, id: { in: wonDealIds } }, select: { id: true, contactId: true } }),
        tx.contact.findMany({ where: { tenantId: auth.tenantId, companyId: { in: cids }, deletedAt: null } }),
        tx.rfq.findMany({ where: { tenantId: auth.tenantId, companyId: { in: cids }, contactId: { not: null } }, select: { contactId: true } }),
        tx.sampbidxTransfer.findMany({ where: { tenantId: auth.tenantId, kind: 'CLIENT', companyId: { in: cids }, delivery: 'SENDING', updatedAt: { gt: new Date(Date.now() - 2 * 60_000) } }, select: { companyId: true } }),
      ]);
      const sharedRfq = new Set(rfqContacts.map((r) => r.contactId));
      return order.map((id): Plan => {
        const c = companies.find((x) => x.id === id);
        const base = { recordId: id, warnings: [] as string[], fixes: [] as SampbidxBulkFix[], inSampbidx: false };
        if (!c) return { item: { ...base, label: 'Company', sub: null, status: 'SKIP', reason: 'Not found, or not visible to you.' }, contactIds: [], companyId: null };
        const link = links.find((l) => l.companyId === id);
        const item: SampbidxBulkPreviewItem = { ...base, label: c.name, sub: c.leadNumber ?? null, status: 'READY', reason: null, inSampbidx: !!link };
        const skip = (reason: string): Plan => ({ item: { ...item, status: 'SKIP', reason }, contactIds: [], companyId: id });
        if (!c.wonAt) return skip('Not a won company. Only won companies go in this send.');
        if (!canSeeDetails(v, c.ownerId)) return skip('Your role cannot see the details of this company.');
        if (busy.some((b) => b.companyId === id)) return skip('It is being sent right now.');
        const staff = contributors.filter((p) => p.companyId === id);
        const linked = new Set(((link?.contacts as { contactId: string }[] | null) ?? []).map((x) => x.contactId));
        const mainId = wonDeals.find((d) => d.id === c.wonDealId)?.contactId ?? null;
        const main = staff.find((p) => p.id === mainId) ?? null;
        // The won deal's contact, then the RFQ contributors and the contacts SampBidx already has.
        const others = staff.filter((p) => p.id !== main?.id && (p.rfqContributorAt || sharedRfq.has(p.id) || linked.has(p.id)));
        const contactIds: string[] = [];
        if (main) {
          const p = previewContact(main, c, null);
          for (const f of missingContactFields(p)) if (f !== 'name') item.fixes.push({ record: 'contact', recordId: main.id, recordLabel: p.name.value as string, field: f });
          contactIds.push(main.id);
        }
        for (const o of others) {
          const p = previewContact(o, c, null);
          const gaps = missingContactFields(p);
          if (gaps.length) item.warnings.push(`${p.name.value} is left out: no ${gaps.map((g) => FIELD_LABEL[g as SampbidxBulkFix['field']] ?? g).join(', ')}.`);
          else contactIds.push(o.id);
        }
        if (!contactIds.length) item.warnings.push('No employee to send as the client contact: the won deal has no contact and nobody shared an RFQ.');
        const changed = !link || c.updatedAt > synced(link) || staff.some((p) => contactIds.includes(p.id) && (p.updatedAt > synced(link) || !linked.has(p.id)));
        if (!changed && !resend) return skip(`Already in SampBidx and unchanged since ${synced(link).toISOString().slice(0, 10)}. Tick “Send again” to send it anyway.`);
        if (item.fixes.length) Object.assign(item, { status: 'NEEDS_FIX', reason: `Missing ${item.fixes.map((f) => `${f.recordLabel}’s ${FIELD_LABEL[f.field]}`).join(', ')}.` });
        return { item, contactIds, companyId: id };
      });
    });
  }

  /** What was typed on the check screen, saved to the records it belongs to (audited like any edit). */
  private async saveCompletion(auth: AuthContext, kind: SampbidxBatchKind, done: SampbidxBatchCompletion, meta: RequestMeta) {
    await this.prisma.run(auth, async (tx) => {
      const v = await visibility(tx, auth);
      for (const [id, d] of Object.entries(done.deals ?? {})) {
        if (kind !== 'DEALS' || d.amount === undefined) continue;
        const deal = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...dealScope(v) }, select: { id: true } });
        if (!deal) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deal not found.' });
        await tx.opportunity.update({ where: { id }, data: { amount: d.amount } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.updated', entityType: 'deal', entityId: id, metadata: { fields: ['amount'], via: 'sampbidx_bulk' }, meta });
      }
      for (const [id, c] of Object.entries(done.contacts ?? {})) {
        const data: Prisma.ContactUpdateInput = {};
        if (c.email) data.email = c.email;
        if (c.country) data.country = c.country;
        if (c.timeZone) data.timezone = c.timeZone;
        if (!Object.keys(data).length) continue;
        const contact = await tx.contact.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, company: { is: { deletedAt: null, ...companyScope(v) } } }, select: { id: true } });
        if (!contact) throw new BadRequestException({ code: 'INVALID_CONTACT', message: 'One of the chosen employees is not at this company.' });
        await tx.contact.update({ where: { id }, data: { ...data, updatedById: auth.userId } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contact.updated', entityType: 'contact', entityId: id, metadata: { fields: Object.keys(data), via: 'sampbidx_bulk' }, meta });
      }
    });
  }

  // ─── Running ───

  private kick(auth: AuthContext, batchId: string) {
    if (this.running.has(batchId)) return;
    this.running.add(batchId);
    void this.run(auth, batchId)
      .catch((e) => this.log.error(`Batch ${batchId} stopped: ${(e as Error).message}`))
      .finally(() => this.running.delete(batchId));
  }

  private async run(auth: AuthContext, batchId: string) {
    let conn: AppConnection | null = null;
    let connProblem: string | null = null;
    try {
      conn = await this.sampbidx.usableConnection(auth.tenantId);
    } catch (e) {
      connProblem = errorText(e);
    }
    const batch = await this.prisma.run(auth, (tx) => tx.sampbidxBatch.findUniqueOrThrow({ where: { id: batchId } }));
    const items = itemsOf(batch);
    const save = (done = false) =>
      this.prisma.run(auth, (tx) => tx.sampbidxBatch.update({ where: { id: batchId }, data: { items: items as unknown as Prisma.InputJsonValue, ...(done ? { status: 'DONE', finishedAt: new Date() } : {}) } }));
    for (const item of items) {
      if (item.outcome !== 'PENDING' && item.outcome !== 'SENDING') continue;
      if (!conn) {
        Object.assign(item, { outcome: 'FAILED', reason: connProblem });
        continue;
      }
      item.outcome = 'SENDING';
      await save();
      try {
        const r = batch.kind === 'DEALS' ? await this.sendDeal(auth, conn, batchId, item) : await this.sendCompany(auth, conn, batchId, item);
        Object.assign(item, r);
      } catch (e) {
        Object.assign(item, { outcome: 'FAILED', reason: errorText(e) });
      }
      // A refused key stops the batch: every later send would be refused the same way.
      if ((item.outcome as string) === 'FAILED') {
        const now = await this.connection(auth.tenantId);
        if (now?.status === 'ERROR') {
          conn = null;
          connProblem = now.lastError ?? item.reason;
        }
      }
      await save();
    }
    // The person who started it hears the outcome, also when they left the page (on-screen card and the bell).
    const sent = items.filter((i) => i.outcome === 'SENT').length;
    const failed = items.filter((i) => i.outcome === 'FAILED').length;
    const skipped = items.filter((i) => i.outcome === 'SKIPPED').length;
    await this.prisma
      .run(auth, (tx) =>
      this.notifications.send(tx, auth.tenantId, [batch.createdById], {
        type: failed ? 'sampbidx.transfer_failed' : 'sampbidx.transfer_completed',
        title: failed ? `SampBidx send finished with ${failed} failed` : `SampBidx confirmed ${sent} of ${items.length}`,
        body: `Sent ${sent}, failed ${failed}, skipped ${skipped}.`,
        link: batch.kind === 'DEALS' ? '/app/deals?view=list' : '/app/companies',
        eventId: `sampbidx-batch-${batchId}-${batch.updatedAt.getTime()}`,
      }),
      )
      .catch((e) => this.log.warn(`Batch ${batchId}: no notification: ${(e as Error).message}`));
    await save(true);
  }

  private async sendCompany(auth: AuthContext, conn: AppConnection, batchId: string, item: StoredItem): Promise<Partial<StoredItem>> {
    const client = await this.transfer(auth, conn, batchId, item, 'CLIENT', item.recordId, null, item.contactIds);
    if (client.delivery !== 'SENT') return { outcome: 'FAILED', reason: client.lastError };
    return { outcome: 'SENT', reason: null, remoteId: client.remoteId, remoteUrl: client.remoteUrl };
  }

  private async sendDeal(auth: AuthContext, conn: AppConnection, batchId: string, item: StoredItem): Promise<Partial<StoredItem>> {
    const deal = await this.prisma.run(auth, (tx) => tx.opportunity.findFirst({ where: { id: item.recordId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, companyId: true, contactId: true, updatedAt: true, company: { select: { updatedAt: true } }, contact: { select: { updatedAt: true } } } }));
    if (!deal?.companyId) return { outcome: 'SKIPPED', reason: 'The deal or its company is no longer in SampForce.' };
    const link = await this.prisma.run(auth, (tx) => tx.sampbidxClient.findUnique({ where: { tenantId_companyId: { tenantId: auth.tenantId, companyId: deal.companyId! } } }));
    const linked = new Set(((link?.contacts as { contactId: string }[] | null) ?? []).map((x) => x.contactId));
    const clientNeeded = !link || deal.company!.updatedAt > synced(link) || (deal.contactId && (!linked.has(deal.contactId) || deal.contact!.updatedAt > synced(link)));
    const sentClient = await this.prisma.run(auth, (tx) => tx.sampbidxTransfer.findFirst({ where: { tenantId: auth.tenantId, id: { in: item.transferIds }, kind: 'CLIENT', delivery: 'SENT' }, select: { id: true } }));
    if (clientNeeded && !sentClient) {
      const client = await this.transfer(auth, conn, batchId, item, 'CLIENT', deal.companyId, null, deal.contactId ? [deal.contactId] : []);
      // Without the client SampBidx could not link the deal, so the deal is not sent.
      if (client.delivery !== 'SENT') return { outcome: 'FAILED', reason: `The client was not accepted, so the deal was not sent: ${client.lastError}` };
    }
    const t = await this.transfer(auth, conn, batchId, item, 'DEAL', deal.companyId, deal.id, deal.contactId ? [deal.contactId] : []);
    if (t.delivery !== 'SENT') return { outcome: 'FAILED', reason: t.lastError };
    return { outcome: 'SENT', reason: null, remoteId: t.remoteId, remoteUrl: t.remoteUrl };
  }

  /** The item's unsent transfer of this kind is sent again (same Idempotency-Key); otherwise a new one is made. */
  private async transfer(auth: AuthContext, conn: AppConnection, batchId: string, item: StoredItem, kind: 'CLIENT' | 'DEAL', companyId: string, dealId: string | null, contactIds: string[]) {
    const t = await this.prisma.run(auth, async (tx) => {
      const prior = await tx.sampbidxTransfer.findFirst({ where: { tenantId: auth.tenantId, id: { in: item.transferIds }, kind, delivery: { not: 'SENT' } }, omit: { emailFileData: true } });
      if (prior) return prior;
      const company = await tx.company.findFirstOrThrow({ where: { id: companyId, tenantId: auth.tenantId }, select: { name: true } });
      const created = await tx.sampbidxTransfer.create({
        data: {
          tenantId: auth.tenantId,
          kind,
          title: kind === 'CLIENT' ? `Client ${company.name}` : `Deal ${item.label}`,
          companyId,
          dealId,
          batchId,
          contactId: contactIds[0] ?? null,
          sentPayload: (kind === 'CLIENT' ? { contactIds, mayReceiveQuotes: true } : {}) as Prisma.InputJsonValue,
          createdById: auth.userId,
        },
        omit: { emailFileData: true },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: kind === 'CLIENT' ? 'sampbidx.client_sent' : 'sampbidx.deal_sent', entityType: kind === 'CLIENT' ? 'company' : 'deal', entityId: dealId ?? companyId, metadata: { transferId: created.id, batchId, contacts: contactIds.length } });
      return created;
    });
    if (!item.transferIds.includes(t.id)) item.transferIds.push(t.id);
    return this.sampbidx.deliver(auth, conn, t);
  }

  // ─── Helpers ───

  private async find(auth: AuthContext, id: string): Promise<SampbidxBatch> {
    const b = await this.prisma.run(auth, (tx) => tx.sampbidxBatch.findFirst({ where: { id, tenantId: auth.tenantId, ...(this.canSeeAll(auth) ? {} : { createdById: auth.userId }) } }));
    if (!b) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found.' });
    return b;
  }

  /** Admins see every bulk send of the workspace; others see their own. */
  private canSeeAll(auth: AuthContext) {
    return auth.permissions.includes('integrations:manage');
  }

  private async row(auth: AuthContext, b: SampbidxBatch): Promise<SampbidxBatchRow> {
    const items = itemsOf(b).map(({ contactIds: _c, ...i }) => i);
    const by = await this.prisma.run(auth, (tx) => personRefs(tx, auth.tenantId, [b.createdById]));
    const count = (o: SampbidxBatchItem['outcome'][]) => items.filter((i) => o.includes(i.outcome)).length;
    return {
      id: b.id,
      kind: b.kind as SampbidxBatchKind,
      status: b.status === 'DONE' ? 'DONE' : 'RUNNING',
      resend: b.resend,
      total: items.length,
      counts: { pending: count(['PENDING', 'SENDING']), sent: count(['SENT']), failed: count(['FAILED']), skipped: count(['SKIPPED']) },
      items,
      createdBy: by.get(b.createdById)?.name ?? null,
      createdAt: b.createdAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
    };
  }

  private connection(tenantId: string) {
    return this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'SAMPBIDX' } } }));
  }
}

type StoredItem = SampbidxBatchItem & { contactIds: string[] };

function itemsOf(b: SampbidxBatch): StoredItem[] {
  return (Array.isArray(b.items) ? b.items : []) as unknown as StoredItem[];
}

/** When SampBidx last confirmed the client; never confirmed counts as long ago. */
function synced(link: { lastSyncedAt: Date | null } | null | undefined): Date {
  return link?.lastSyncedAt ?? new Date(0);
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** The message a person should read: SampBidx's own reason, or the API error's message. */
function errorText(e: unknown): string {
  if (e instanceof SampbidxError) return e.message;
  const r = (e as { getResponse?: () => unknown }).getResponse?.();
  if (r && typeof r === 'object' && typeof (r as { message?: unknown }).message === 'string') return (r as { message: string }).message;
  return (e as Error).message || 'Something went wrong.';
}

