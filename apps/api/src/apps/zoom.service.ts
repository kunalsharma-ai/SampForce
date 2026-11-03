import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { type AppConnection, Prisma, type ZoomMeeting } from '@dealflow/database';
import type { ZoomMeetingCreate, ZoomMeetingRow, ZoomTranscriptStatus } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { WebhookReceipts } from '../common/webhook-receipts';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { assertRefs } from '../crm/crm-helpers';
import { claim, errorMessage } from '../worker/queue';
import { AppError, AppsService, type StoredZoom } from './apps.service';
import { refreshUnderLock } from './oauth-refresh';
import { parseZoomVtt, ZoomClient, ZoomError } from './zoom';

interface TranscriptSource {
  url: string;
  token: string;
}

const MAX_IMPORT_ATTEMPTS = 3;

/**
 * Zoom meetings scheduled from DealFlow records, and the import of their cloud-recording transcripts.
 * Only meetings created here, with recording chosen by the organiser, are ever imported; other meetings in the Zoom
 * account are ignored even when Zoom sends events about them.
 */
@Injectable()
export class ZoomService {
  private readonly log = new Logger(ZoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly zoom: ZoomClient,
    private readonly activities: ActivitiesService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly receipts: WebhookReceipts,
  ) {}

  async schedule(
    auth: AuthContext,
    input: ZoomMeetingCreate,
    meta: RequestMeta,
  ): Promise<ZoomMeetingRow> {
    const conn = await this.apps.requireConnection(auth.tenantId, 'zoom');
    if (conn.status === 'ERROR')
      throw new AppError(conn.lastError ?? 'Zoom needs reconnecting in Integrations.');
    if (input.recordToCloud && !this.zoom.webhookConfigured) {
      throw new AppError(
        'Transcript import is Pending Configuration: an operator must add ZOOM_WEBHOOK_SECRET_TOKEN. Schedule without recording, or record in Zoom yourself.',
      );
    }
    const host = await this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, {
        leadId: input.leadId,
        contactId: input.contactId,
        opportunityId: input.dealId,
      });
      return tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } });
    });
    const created = await this.withToken(auth.tenantId, conn, (token) =>
      this.zoom.createMeeting(token, host.email, {
        topic: input.topic,
        startTime: new Date(input.startsAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        duration: input.durationMinutes,
        timezone: input.timezone,
        recordToCloud: input.recordToCloud,
      }),
    ).catch(async (e: unknown) => {
      await this.apps.recordEvent(auth.tenantId, conn, {
        kind: 'meeting.failed',
        ok: false,
        externalId: null,
        summary: `Not scheduled: ${input.topic}: ${errorMessage(e)}`,
        actorUserId: auth.userId,
        ...link(input),
      });
      throw e instanceof ZoomError ? new AppError(e.message) : e;
    });
    const startsAt = new Date(created.startTime || input.startsAt);
    const activity = await this.activities.create(
      auth,
      {
        type: 'MEETING',
        subject: `Zoom: ${input.topic}`.slice(0, 200),
        body: `Zoom meeting scheduled for ${startsAt.toISOString()} (${input.durationMinutes} minutes).\nJoin: ${created.joinUrl}${input.recordToCloud ? '\nRecorded to the Zoom cloud; the transcript will be added to meeting notes.' : ''}`,
        occurredAt: startsAt.toISOString(),
        leadId: input.leadId,
        contactId: input.contactId,
        opportunityId: input.dealId,
      },
      meta,
    );
    const row = await this.prisma.run(auth, async (tx) => {
      const m = await tx.zoomMeeting.create({
        data: {
          tenantId: auth.tenantId,
          connectionId: conn.id,
          zoomMeetingId: created.id,
          hostEmail: host.email,
          topic: input.topic,
          startsAt,
          durationMinutes: created.duration || input.durationMinutes,
          joinUrl: created.joinUrl,
          recordToCloud: input.recordToCloud,
          leadId: input.leadId ?? null,
          contactId: input.contactId ?? null,
          dealId: input.dealId ?? null,
          createdById: auth.userId,
          activityId: activity.id,
          transcriptStatus: input.recordToCloud ? 'waiting' : 'none',
        },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'zoom.meeting_scheduled',
        entityType: 'zoom_meeting',
        entityId: m.id,
        metadata: {
          zoomMeetingId: created.id,
          recordToCloud: input.recordToCloud,
          recordingConsentConfirmed: input.recordToCloud ? input.recordingConsent : null,
          ...link(input),
        },
        meta,
      });
      return m;
    });
    await this.apps.recordEvent(auth.tenantId, conn, {
      kind: 'meeting.created',
      ok: true,
      externalId: created.id,
      summary: `Scheduled “${input.topic}” for ${host.email}`,
      actorUserId: auth.userId,
      ...link(input),
    });
    return (await this.rows(auth, [row]))[0]!;
  }

  async list(
    auth: AuthContext,
    q: { leadId?: string; contactId?: string; dealId?: string },
  ): Promise<ZoomMeetingRow[]> {
    const rows = await this.prisma.run(auth, (tx) =>
      tx.zoomMeeting.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.leadId ? { leadId: q.leadId } : {}),
          ...(q.contactId ? { contactId: q.contactId } : {}),
          ...(q.dealId ? { dealId: q.dealId } : {}),
        },
        orderBy: { startsAt: 'desc' },
        take: 50,
      }),
    );
    return this.rows(auth, rows);
  }

  // ───── Zoom events ─────

  /** Zoom event notifications. Authenticated by the signature only; unknown accounts and meetings are ignored. */
  async handleEvent(
    raw: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<object> {
    if (!this.zoom.webhookConfigured)
      throw new ForbiddenException({
        code: 'PENDING_CONFIGURATION',
        message: 'Zoom events are not configured on this installation.',
      });
    const h = (k: string) =>
      Array.isArray(headers[k]) ? headers[k]![0] : (headers[k] as string | undefined);
    if (!raw || !this.zoom.verifySignature(raw, h('x-zm-request-timestamp'), h('x-zm-signature'))) {
      await this.receipts.rejected('zoom', 'The signature did not match the webhook secret token (or the request was too old).');
      throw new UnauthorizedException({
        code: 'BAD_SIGNATURE',
        message: 'Signature check failed.',
      });
    }
    const body = JSON.parse(raw.toString('utf8')) as ZoomEvent;
    await this.receipts.verified('zoom', String(body.event ?? 'unknown'));
    if (body.event === 'endpoint.url_validation')
      return this.zoom.urlValidation(String(body.payload?.plainToken ?? ''));
    const accountId = body.payload?.account_id;
    if (!accountId) return { ok: true };
    // One Zoom account can be connected to more than one DealFlow workspace.
    const conns = await this.connectionsForAccount(accountId);
    if (body.event === 'app_deauthorized') {
      for (const conn of conns) {
        await this.prisma.run({ tenantId: conn.tenantId }, async (tx) => {
          await tx.appConnection.delete({ where: { id: conn.id } });
          await this.audit.record(tx, {
            tenantId: conn.tenantId,
            actorUserId: null,
            action: 'app.disconnected',
            entityType: 'app_connection',
            entityId: conn.id,
            metadata: { app: 'zoom', reason: 'removed in Zoom Marketplace' },
          });
        });
      }
      return { ok: true };
    }

    if (body.event === 'recording.transcript_completed') {
      const object = body.payload?.object;
      const file = object?.recording_files?.find(
        (f) => f.file_type === 'TRANSCRIPT' && f.download_url,
      );
      if (!object?.id || !file || !body.download_token) return { ok: true };
      const zoomMeetingId = String(object.id);
      const sealed = this.box.seal(
        JSON.stringify({
          url: file.download_url!,
          token: body.download_token,
        } satisfies TranscriptSource),
      );
      for (const conn of conns) {
        const updated = await this.prisma.run({ tenantId: conn.tenantId }, (tx) =>
          tx.zoomMeeting.updateMany({
            where: {
              tenantId: conn.tenantId,
              zoomMeetingId,
              recordToCloud: true,
              transcriptStatus: { in: ['waiting', 'failed'] },
            },
            data: {
              transcriptStatus: 'ready',
              transcriptSource: sealed,
              transcriptError: null,
              transcriptAttempts: 0,
            },
          }),
        );
        if (updated.count) {
          await this.apps.recordEvent(conn.tenantId, conn, {
            kind: 'transcript.received',
            ok: true,
            externalId: zoomMeetingId,
            summary: `Zoom sent the transcript for meeting ${zoomMeetingId}`,
            actorUserId: null,
          });
        }
      }
      return { ok: true };
    }
    return { ok: true };
  }

  /** Worker job: imports transcripts Zoom has delivered into meeting notes. */
  async importDue(): Promise<number> {
    const due = await claim<{ id: string; tenant_id: string }>(
      this.prisma,
      Prisma.sql`SELECT id, tenant_id FROM zoom_meetings WHERE transcript_status = 'ready' OR (transcript_status = 'importing' AND updated_at < now() - interval '10 minutes') ORDER BY updated_at LIMIT 10`,
    );
    let n = 0;
    for (const d of due) {
      try {
        if (await this.importOne(d.tenant_id, d.id)) n++;
      } catch (err) {
        this.log.error(
          { err: errorMessage(err), tenantId: d.tenant_id },
          'zoom transcript import failed',
        );
      }
    }
    return n;
  }

  private async importOne(tenantId: string, id: string): Promise<boolean> {
    // Take the job: only one worker moves it from ready to importing.
    const m = await this.prisma.run({ tenantId }, async (tx) => {
      const taken = await tx.zoomMeeting.updateMany({
        where: {
          id,
          OR: [
            { transcriptStatus: 'ready' },
            {
              transcriptStatus: 'importing',
              updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
            },
          ],
        },
        data: { transcriptStatus: 'importing', transcriptAttempts: { increment: 1 } },
      });
      return taken.count ? tx.zoomMeeting.findUnique({ where: { id } }) : null;
    });
    if (!m?.transcriptSource) return false;
    const conn = m.connectionId
      ? await this.prisma.run({ tenantId }, (tx) =>
          tx.appConnection.findUnique({ where: { id: m.connectionId! } }),
        )
      : null;
    try {
      const src = JSON.parse(this.box.open(m.transcriptSource)) as TranscriptSource;
      const vtt = await this.zoom.downloadTranscript(src.url, src.token);
      const parsed = parseZoomVtt(vtt);
      if (!parsed.text.trim()) throw new ZoomError('empty', 'Zoom’s transcript was empty.');
      await this.prisma.run({ tenantId }, async (tx) => {
        const record = await tx.meetingRecord.create({
          data: {
            tenantId,
            title: m.topic.slice(0, 300),
            occurredAt: m.startsAt,
            leadId: m.leadId,
            contactId: m.contactId,
            dealId: m.dealId,
            source: 'transcript',
            transcript: parsed.text,
            segments: parsed.segments as unknown as Prisma.InputJsonValue,
            transcriptionStatus: 'done',
            transcriptionProvider: 'zoom',
            // The organiser confirmed participants' consent when choosing cloud recording.
            recordingConsentById: m.createdById,
            recordingConsentAt: m.createdAt,
            createdById: m.createdById,
          },
        });
        await tx.zoomMeeting.update({
          where: { id },
          data: {
            transcriptStatus: 'imported',
            meetingRecordId: record.id,
            transcriptSource: null,
            transcriptError: null,
          },
        });
        await this.audit.record(tx, {
          tenantId,
          actorUserId: null,
          action: 'meeting_record.transcribed',
          entityType: 'meeting_record',
          entityId: record.id,
          metadata: {
            provider: 'zoom',
            zoomMeetingId: m.zoomMeetingId,
            segments: parsed.segments.length,
          },
        });
      });
      if (conn)
        await this.apps.recordEvent(tenantId, conn, {
          kind: 'transcript.imported',
          ok: true,
          externalId: m.zoomMeetingId,
          summary: `Transcript of “${m.topic}” added to meeting notes`,
          actorUserId: null,
          ...link(m),
        });
      return true;
    } catch (e) {
      const message = e instanceof ZoomError ? e.message : 'The transcript could not be imported.';
      const final =
        (e instanceof ZoomError &&
          ['download_expired', 'bad_url', 'too_large', 'empty'].includes(e.code)) ||
        m.transcriptAttempts >= MAX_IMPORT_ATTEMPTS;
      await this.prisma.run({ tenantId }, (tx) =>
        tx.zoomMeeting.update({
          where: { id },
          data: {
            transcriptStatus: final ? 'failed' : 'ready',
            transcriptError: message,
            ...(final ? { transcriptSource: null } : {}),
          },
        }),
      );
      if (conn && final)
        await this.apps.recordEvent(tenantId, conn, {
          kind: 'transcript.failed',
          ok: false,
          externalId: m.zoomMeetingId,
          summary: `Transcript of “${m.topic}” not imported: ${message}`,
          actorUserId: null,
          ...link(m),
        });
      return false;
    }
  }

  // ───── Tokens ─────

  /** Runs a Zoom call with a fresh access token; refreshes once on expiry or a 401, marking the app if that fails. */
  private async withToken<T>(
    tenantId: string,
    conn: AppConnection,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    let creds = this.creds(conn);
    if (creds.expiresAt - 60_000 < Date.now()) creds = await this.refresh(tenantId, conn.id);
    try {
      const out = await fn(creds.accessToken);
      await this.prisma.run({ tenantId }, (tx) =>
        tx.appConnection.update({
          where: { id: conn.id },
          data: { lastUsedAt: new Date(), status: 'CONNECTED', lastError: null },
        }),
      );
      return out;
    } catch (e) {
      if (!(e instanceof ZoomError) || e.code !== 'unauthorized') throw e;
      creds = await this.refresh(tenantId, conn.id, creds.accessToken);
      return fn(creds.accessToken);
    }
  }

  private refresh(tenantId: string, connectionId: string, staleAccessToken?: string): Promise<StoredZoom> {
    return refreshUnderLock<StoredZoom>(this.prisma, this.box, tenantId, connectionId, (rt) => this.zoom.refresh(rt), (e): e is ZoomError => e instanceof ZoomError && e.revoked, staleAccessToken);
  }

  private creds(conn: AppConnection): StoredZoom {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as StoredZoom;
  }

  private async connectionsForAccount(accountId: string): Promise<AppConnection[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.app_provider', 'ZOOM', true), set_config('app.app_account', ${accountId}, true)`;
      return tx.appConnection.findMany({
        where: { provider: 'ZOOM', externalAccountId: accountId },
        take: 50,
      });
    });
  }

  private async rows(auth: AuthContext, rows: ZoomMeeting[]): Promise<ZoomMeetingRow[]> {
    const people = await this.prisma.run(auth, (tx) =>
      tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
        select: { id: true, name: true },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      zoomMeetingId: r.zoomMeetingId,
      topic: r.topic,
      startsAt: r.startsAt.toISOString(),
      durationMinutes: r.durationMinutes,
      joinUrl: r.joinUrl,
      hostEmail: r.hostEmail,
      recordToCloud: r.recordToCloud,
      leadId: r.leadId,
      contactId: r.contactId,
      dealId: r.dealId,
      createdBy: people.find((p) => p.id === r.createdById)?.name ?? null,
      transcriptStatus: (r.transcriptStatus === 'importing'
        ? 'ready'
        : r.transcriptStatus) as ZoomTranscriptStatus,
      transcriptError: r.transcriptError,
      meetingRecordId: r.meetingRecordId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

function link(x: { leadId?: string | null; contactId?: string | null; dealId?: string | null }): {
  entityType: string | null;
  entityId: string | null;
} {
  if (x.dealId) return { entityType: 'deal', entityId: x.dealId };
  if (x.contactId) return { entityType: 'contact', entityId: x.contactId };
  if (x.leadId) return { entityType: 'lead', entityId: x.leadId };
  return { entityType: null, entityId: null };
}

interface ZoomEvent {
  event?: string;
  download_token?: string;
  payload?: {
    plainToken?: string;
    account_id?: string;
    object?: {
      id?: number | string;
      uuid?: string;
      recording_files?: { file_type?: string; download_url?: string; status?: string }[];
    };
  };
}
