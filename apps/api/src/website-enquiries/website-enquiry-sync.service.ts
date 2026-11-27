import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EnquiryRecord, EnquirySyncStatus } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { fingerprintOf } from '../common/provider-keys';
import { WebhookReceipts } from '../common/webhook-receipts';
import { personRefs } from '../crm/visibility';
import { fetchPage, patchLead, WebsiteApiError, websiteConfigured } from './website-api';
import { WebsiteEnquiriesService } from './website-enquiries.service';

export const SYNC_STATE_KEY = 'website_enquiries:sync';
/** A sync that stops halfway (a crash, a deploy) lets another worker take over after this long. */
const LEASE_MS = 10 * 60_000;
/** The website's own retry schedule, reused for sending statuses back. After the last one it gives up. */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000];
/** At most this many pages per collection in one pass, so a first import of a huge site is spread over several passes. */
const MAX_PAGES = 50;
const WRITE_BACKS_PER_PASS = 25;

const COLLECTIONS: { name: 'leads' | 'contacts' | 'reviews'; record: EnquiryRecord; source?: string }[] = [
  { name: 'leads', record: 'lead' },
  // Every form sender is a contact on the website too; only newsletter sign-ups are new here.
  { name: 'contacts', record: 'contact', source: 'newsletter' },
  { name: 'reviews', record: 'review' },
];

interface SyncState {
  /** Which website and workspace the cursors belong to; a change starts again with a full import. */
  target: string | null;
  /** Per collection: the time the last complete pass started (minus a minute), for `updatedSince`. */
  since: Partial<Record<'leads' | 'contacts' | 'reviews', string>>;
  /** Where a pass that stopped at MAX_PAGES goes on. */
  cursor: Partial<Record<'leads' | 'contacts' | 'reviews', string>>;
  last: { at: string; ok: boolean; message: string; received: number } | null;
  leaseUntil: string | null;
}

const EMPTY: SyncState = { target: null, since: {}, cursor: {}, last: null, leaseUntil: null };

function readState(raw: string | null | undefined): SyncState {
  try {
    return { ...EMPTY, ...(raw ? (JSON.parse(raw) as Partial<SyncState>) : {}) };
  } catch {
    return { ...EMPTY };
  }
}

export interface SyncResult {
  ran: boolean;
  ok: boolean;
  message: string;
  received: number;
}

/**
 * The safety net under the website's webhook (ADR 0095): every WEBSITE_ENQUIRY_SYNC_MS the worker asks the website for
 * leads, newsletter sign-ups and reviews made or changed since the last pass (all of them the first time) and upserts
 * them by the website's id. It also sends SampForce status changes back to the website (PATCH /leads/:id), retrying
 * on the website's own schedule. Several workers can run: a lease in platform_settings lets one sync at a time.
 */
@Injectable()
export class WebsiteEnquirySync {
  private readonly log = new Logger(WebsiteEnquirySync.name);
  private lastCheck = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enquiries: WebsiteEnquiriesService,
    private readonly receipts: WebhookReceipts,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private target(tenantId: string): string {
    return fingerprintOf(`${(this.env.WEBSITE_API_BASE_URL ?? '').replace(/\/+$/, '')}|${tenantId}`);
  }

  private async state(): Promise<{ raw: string | null; state: SyncState }> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: SYNC_STATE_KEY } });
    return { raw: row?.value ?? null, state: readState(row?.value) };
  }

  /** Compare-and-set on the stored text, so two workers never both take the lease. */
  private async swap(raw: string | null, next: SyncState): Promise<boolean> {
    const value = JSON.stringify(next);
    if (raw === null) {
      try {
        await this.prisma.platformSetting.create({ data: { key: SYNC_STATE_KEY, value } });
        return true;
      } catch {
        return false;
      }
    }
    const res = await this.prisma.platformSetting.updateMany({ where: { key: SYNC_STATE_KEY, value: raw }, data: { value } });
    return res.count === 1;
  }

  /** Worker tick: a pull when one is due, then statuses waiting to go back to the website. */
  async sweep(): Promise<number> {
    // The tick runs every few seconds; the settings and the state are read at most every 5 seconds.
    if (Date.now() - this.lastCheck < 5_000) return 0;
    this.lastCheck = Date.now();
    if (!websiteConfigured(this.env)) return 0;
    const tenantId = await this.enquiries.receivingTenant();
    if (!tenantId) return 0;
    let n = 0;
    const { state } = await this.state();
    const lastAt = state.last ? Date.parse(state.last.at) : 0;
    const resume = Object.keys(state.cursor).length > 0;
    if (resume || state.target !== this.target(tenantId) || Date.now() - lastAt >= this.env.WEBSITE_ENQUIRY_SYNC_MS) n += (await this.run(tenantId)).received;
    n += await this.flushWriteBacks(tenantId);
    return n;
  }

  /** "Sync now" on the Website Enquiry page. */
  async syncNow(tenantId: string): Promise<SyncResult> {
    if (!websiteConfigured(this.env)) return { ran: false, ok: false, message: 'The website API address and key are not set in the Console yet.', received: 0 };
    if ((await this.enquiries.receivingTenant()) !== tenantId) return { ran: false, ok: false, message: 'This workspace is not the one the Console set to receive website enquiries.', received: 0 };
    const r = await this.run(tenantId);
    await this.flushWriteBacks(tenantId);
    return r;
  }

  private async run(tenantId: string): Promise<SyncResult> {
    const { raw, state: current } = await this.state();
    if (current.leaseUntil && Date.parse(current.leaseUntil) > Date.now()) return { ran: false, ok: true, message: 'A sync is already running.', received: 0 };
    const target = this.target(tenantId);
    // Another website or workspace: start again from the beginning.
    const state: SyncState = current.target === target ? current : { ...EMPTY, last: current.last };
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    if (!(await this.swap(raw, { ...state, target, leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() }))) return { ran: false, ok: true, message: 'A sync is already running.', received: 0 };
    let received = 0;
    let message = '';
    let ok = true;
    const since = { ...state.since };
    const cursor = { ...state.cursor };
    try {
      for (const c of COLLECTIONS) {
        const first = !since[c.name] && !cursor[c.name];
        let next = cursor[c.name] ?? null;
        let pages = 0;
        do {
          let page;
          try {
            page = await fetchPage(this.env, c.name, { updatedSince: since[c.name] ?? null, cursor: next, source: c.source });
          } catch (err) {
            // A key without contacts:read or reviews:read skips that collection rather than failing the whole sync.
            if (err instanceof WebsiteApiError && err.status === 403 && c.name !== 'leads') {
              next = null;
              break;
            }
            throw err;
          }
          for (const item of page.data) {
            // The first import brings in history: no notification for each old lead.
            const out = await this.enquiries.ingest(tenantId, c.record, item, 'pull', { notify: !first });
            if (out?.created) received++;
          }
          next = page.hasMore ? page.nextCursor : null;
          pages++;
        } while (next && pages < MAX_PAGES);
        if (next) cursor[c.name] = next;
        else {
          delete cursor[c.name];
          since[c.name] = startedAt;
        }
      }
      message = received ? `${received} new from the website.` : 'Up to date.';
    } catch (err) {
      ok = false;
      message = err instanceof Error ? err.message.slice(0, 300) : 'The sync failed.';
      this.log.warn({ err: message }, 'website enquiry sync failed');
    }
    const { raw: now } = await this.state();
    await this.swap(now, { target, since, cursor, last: { at: new Date().toISOString(), ok, message, received }, leaseUntil: null });
    return { ran: true, ok, message, received };
  }

  /** Sends waiting status changes back to the website: status, stage, owner, SampForce id, link and note. */
  async flushWriteBacks(tenantId: string): Promise<number> {
    if (!websiteConfigured(this.env)) return 0;
    const due = await this.prisma.run({ tenantId }, (tx) =>
      // On MongoDB `lte` alone also matches null, hence the `not: null`.
      tx.websiteEnquiry.findMany({ where: { tenantId, record: 'lead', writeBackAt: { not: null, lte: new Date() } }, orderBy: { writeBackAt: 'asc' }, take: WRITE_BACKS_PER_PASS }),
    );
    if (!due.length) return 0;
    const people = await this.prisma.run({ tenantId }, (tx) => personRefs(tx, tenantId, due.map((d) => d.assigneeId)));
    const web = this.env.PUBLIC_WEB_URL.replace(/\/+$/, '');
    let sent = 0;
    for (const d of due) {
      const claimedAt = d.writeBackAt!;
      try {
        await patchLead(this.env, d.externalId, {
          status: d.status,
          stage: (d.stage ?? '').slice(0, 80),
          owner: (d.assigneeId ? (people.get(d.assigneeId)?.name ?? '') : '').slice(0, 120),
          sampforceId: d.id.slice(0, 80),
          // The website only shows https links ("Open in Sampforce").
          ...(web.startsWith('https://') ? { url: `${web}/app/website-enquiries?open=${d.id}` } : {}),
          note: (d.note ?? '').slice(0, 2000),
        });
        // Only when nothing changed meanwhile: a newer change stays queued.
        await this.prisma.run({ tenantId }, (tx) => tx.websiteEnquiry.updateMany({ where: { id: d.id, writeBackAt: claimedAt }, data: { writeBackAt: null, writeBackTries: 0, writeBackError: null, writtenBackAt: new Date() } }));
        sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 500) : 'Could not send it to the website.';
        const status = err instanceof WebsiteApiError ? err.status : null;
        const permanent = status !== null && [400, 401, 403, 404, 422].includes(status);
        const tries = d.writeBackTries + 1;
        const next = permanent || tries > BACKOFF_MS.length ? null : new Date(Date.now() + BACKOFF_MS[tries - 1]!);
        await this.prisma.run({ tenantId }, (tx) => tx.websiteEnquiry.updateMany({ where: { id: d.id, writeBackAt: claimedAt }, data: { writeBackAt: next, writeBackTries: tries, writeBackError: message } }));
      }
    }
    return sent;
  }

  /** What the page shows about how enquiries arrive. */
  async status(): Promise<EnquirySyncStatus> {
    const [{ state }, receipt] = await Promise.all([this.state(), this.receipts.read('website')]);
    const configured = websiteConfigured(this.env);
    const lastAt = state.last ? Date.parse(state.last.at) : null;
    return {
      configured,
      lastDelivery: receipt.lastVerified ? { at: receipt.lastVerified.at, event: receipt.lastVerified.event } : null,
      lastRefused: receipt.lastRejected,
      lastPull: state.last,
      nextPullAt: configured ? new Date((lastAt ?? Date.now()) + (lastAt ? this.env.WEBSITE_ENQUIRY_SYNC_MS : 0)).toISOString() : null,
    };
  }
}
