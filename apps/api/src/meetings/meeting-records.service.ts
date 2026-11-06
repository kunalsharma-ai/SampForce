import { BadRequestException, ConflictException, ForbiddenException, Injectable, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  type MeetingAnalysis,
  meetingAnalysisSchema,
  type MeetingRecord,
  type MeetingRecordCreate,
  type MeetingRecordRow,
  type MeetingRecordUpdate,
  type TranscriptionStatus,
  type TranscriptSegment,
} from '@dealflow/types';
import { AgentOutputError, AgentsService } from '../ai/agents.service';
import { PermissionDenied, RecordContextBuilder, type RecordType } from '../ai/record-context';
import { untrusted } from '../ai/redact';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';
import { TasksService } from '../crm/tasks.service';
import { DeepgramClient, TranscriptionError } from './deepgram';

const DAY = 86_400_000;
/** Enough for a long meeting; longer transcripts are cut for the AI (the full text stays stored). */
const AI_TRANSCRIPT_CHARS = 60_000;

const include = {
  deal: { select: { id: true, name: true } },
  meeting: { select: { attendees: true, joinUrl: true } },
} satisfies Prisma.MeetingRecordInclude;
type RecordWith = Prisma.MeetingRecordGetPayload<{ include: typeof include }>;

/**
 * Enhancement feature 7: meeting intelligence. A meeting record holds pasted notes, a pasted transcript, or a
 * recording transcribed by Deepgram (audio streamed through, never stored, and only with the uploader's
 * confirmation that participants agreed). The AI proposes a structured reading; a person reviews and edits it
 * before tasks are created or a note is saved to the CRM record. Nothing is sent from here.
 */
@Injectable()
export class MeetingRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly records: RecordContextBuilder,
    private readonly deepgram: DeepgramClient,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly audit: AuditService,
  ) {}

  async transcriptionStatus(auth: AuthContext): Promise<TranscriptionStatus> {
    // Verified by any successful transcription in this workspace: a meeting recording or a voice note.
    const last = this.deepgram.configured
      ? await this.prisma.run(auth, async (tx) => {
          const where = { tenantId: auth.tenantId, transcriptionProvider: 'deepgram', transcriptionStatus: 'done' };
          const [m, v] = await Promise.all([
            tx.meetingRecord.findFirst({ where, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
            tx.voiceNote.findFirst({ where, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
          ]);
          return [m, v].filter((x): x is { updatedAt: Date } => !!x).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
        })
      : null;
    return {
      provider: 'deepgram',
      state: !this.deepgram.configured ? 'pending_configuration' : last ? 'verified' : 'configured',
      maxUploadMb: Math.round(this.deepgram.maxBytes / 1024 / 1024),
      lastSuccessAt: last?.updatedAt.toISOString() ?? null,
    };
  }

  list(auth: AuthContext, q: { dealId?: string; contactId?: string; leadId?: string }): Promise<MeetingRecordRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.meetingRecord.findMany({
        where: { tenantId: auth.tenantId, ...(q.dealId ? { dealId: q.dealId } : {}), ...(q.contactId ? { contactId: q.contactId } : {}), ...(q.leadId ? { leadId: q.leadId } : {}) },
        include,
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });
      return this.toRows(tx, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<MeetingRecord> {
    return this.prisma.run(auth, async (tx) => this.full(tx, await this.find(tx, auth, id)));
  }

  /** Opens a record for a calendar meeting (one per meeting) or a meeting that is not on a synced calendar. */
  async create(auth: AuthContext, input: MeetingRecordCreate, meta: RequestMeta): Promise<{ record: MeetingRecord; created: boolean }> {
    return this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, { contactId: input.contactId, leadId: input.leadId, opportunityId: input.dealId });
      let title = input.title;
      let occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      let contactId = input.contactId ?? null;
      if (input.meetingId) {
        const m = await tx.meeting.findFirst({ where: { id: input.meetingId, tenantId: auth.tenantId } });
        if (!m) throw notFound('Meeting');
        const existing = await tx.meetingRecord.findFirst({ where: { meetingId: m.id, tenantId: auth.tenantId }, include });
        if (existing) return { record: await this.full(tx, existing), created: false };
        title = title ?? m.title;
        occurredAt = input.occurredAt ? occurredAt : m.startsAt;
        contactId = contactId ?? m.contactIds[0] ?? null;
      }
      const row = await tx.meetingRecord.create({
        data: {
          tenantId: auth.tenantId, meetingId: input.meetingId ?? null, title: title!.slice(0, 300), occurredAt, contactId,
          leadId: input.leadId ?? null, dealId: input.dealId ?? null, createdById: auth.userId,
        },
        include,
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'meeting_record.created', entityType: 'meeting_record', entityId: row.id, metadata: { meetingId: input.meetingId ?? null }, meta });
      return { record: await this.full(tx, row), created: true };
    });
  }

  async update(auth: AuthContext, id: string, input: MeetingRecordUpdate, meta: RequestMeta): Promise<MeetingRecord> {
    return this.prisma.run(auth, async (tx) => {
      const r = await this.find(tx, auth, id);
      await assertRefs(tx, auth.tenantId, { contactId: input.contactId, leadId: input.leadId, opportunityId: input.dealId });
      const data: Prisma.MeetingRecordUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.contactId !== undefined) data.contactId = input.contactId;
      if (input.leadId !== undefined) data.leadId = input.leadId;
      if (input.dealId !== undefined) data.dealId = input.dealId;
      if (input.transcript !== undefined && input.transcript !== r.transcript) {
        // Speaker turns no longer match edited text, so the edited text is what the AI reads from now on.
        data.segments = Prisma.DbNull;
        data.transcript = input.transcript || null;
        data.source = input.source ?? r.source;
      } else if (input.source !== undefined) data.source = input.source;
      if (input.analysis) {
        // Task links are SampForce's to set: keep only ids of tasks this record created.
        const known = new Set(r.taskIds);
        const analysis = { ...input.analysis, actionItems: input.analysis.actionItems.map((a) => ({ ...a, taskId: a.taskId && known.has(a.taskId) ? a.taskId : null })) };
        data.analysis = analysis as unknown as Prisma.InputJsonValue;
        data.reviewedById = auth.userId;
        data.reviewedAt = new Date();
      }
      const row = await tx.meetingRecord.update({ where: { id }, data, include });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: input.analysis ? 'meeting_record.reviewed' : 'meeting_record.updated', entityType: 'meeting_record', entityId: id,
        metadata: { fields: Object.keys(input) }, meta,
      });
      return this.full(tx, row);
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      await this.find(tx, auth, id);
      await tx.meetingRecord.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'meeting_record.deleted', entityType: 'meeting_record', entityId: id, metadata: {}, meta });
    });
  }

  /**
   * Streams an uploaded recording to the transcription service and stores only the text. The uploader confirms
   * that everyone in the meeting agreed to it being recorded and transcribed.
   */
  async transcribe(auth: AuthContext, id: string, upload: { stream: ReadableStream<Uint8Array>; contentType: string; length: number | null; consent: boolean }, meta: RequestMeta): Promise<MeetingRecord> {
    if (!upload.consent) throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Confirm that everyone in the meeting agreed to it being recorded and transcribed.' });
    if (!this.deepgram.configured) {
      throw new ConflictException({ code: 'PENDING_CONFIGURATION', message: 'Transcription is pending configuration: an administrator needs to set DEEPGRAM_API_KEY. You can paste notes or a transcript instead.' });
    }
    if (!/^(audio|video)\/[\w.+-]+$/i.test(upload.contentType)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Upload an audio or video recording.' });
    if (upload.length !== null && upload.length > this.deepgram.maxBytes) throw tooLarge(this.deepgram.maxBytes);
    await this.prisma.run(auth, async (tx) => {
      await this.find(tx, auth, id);
      await tx.meetingRecord.update({ where: { id }, data: { transcriptionStatus: 'processing', transcriptionError: null, recordingConsentById: auth.userId, recordingConsentAt: new Date() } });
    });
    const limited = limitStream(upload.stream, this.deepgram.maxBytes);
    try {
      const result = await this.deepgram.transcribe(limited.stream, upload.contentType);
      return await this.prisma.run(auth, async (tx) => {
        const row = await tx.meetingRecord.update({
          where: { id },
          data: { transcript: result.text, segments: result.segments as unknown as Prisma.InputJsonValue, source: 'recording', transcriptionStatus: 'done', transcriptionProvider: 'deepgram' },
          include,
        });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: 'meeting_record.transcribed', entityType: 'meeting_record', entityId: id,
          metadata: { provider: 'deepgram', durationSeconds: result.durationSeconds, segments: result.segments.length, consentConfirmed: true }, meta,
        });
        return this.full(tx, row);
      });
    } catch (err) {
      const tooBig = limited.exceeded();
      const message = tooBig ? `The recording is larger than ${Math.round(this.deepgram.maxBytes / 1024 / 1024)} MB.` : err instanceof TranscriptionError ? err.message : 'Transcription failed.';
      await this.prisma.run(auth, (tx) => tx.meetingRecord.update({ where: { id }, data: { transcriptionStatus: 'failed', transcriptionError: message } }));
      if (tooBig) throw tooLarge(this.deepgram.maxBytes);
      throw new UnprocessableEntityException({ code: 'TRANSCRIPTION_FAILED', message });
    }
  }

  /** Runs the AI over the transcript or notes. The result is a proposal; it is not marked as reviewed. */
  async analyse(auth: AuthContext, id: string): Promise<MeetingRecord> {
    const r = await this.prisma.run(auth, (tx) => this.find(tx, auth, id));
    const transcript = transcriptForAi(r);
    if (transcript.length < 20) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Add notes or a transcript first (at least a few lines).' });
    const target = targetOf(r);
    const record = target ? await this.facts(auth, target.type, target.id) : null;
    const analysis = await this.agents.withRun(auth, 'meeting_notes', target?.type ?? null, target?.id ?? null, { op: 'meeting_intelligence', recordId: id, source: r.source, length: transcript.length }, undefined, async (run) => {
      let out: MeetingAnalysis;
      try {
        out = await this.agents.structured(auth, run, 'meeting_notes', 'meetingIntelligence', meetingAnalysisSchema, {
          meeting: { title: r.title, date: r.occurredAt.toISOString().slice(0, 10), attendees: r.meeting?.attendees ?? [] },
          record,
          transcriptKind: r.source === 'notes' ? 'notes written by the rep' : 'transcript',
          transcript: untrusted('meeting_transcript', transcript.slice(0, AI_TRANSCRIPT_CHARS)),
          truncated: transcript.length > AI_TRANSCRIPT_CHARS,
        });
      } catch (err) {
        if (err instanceof AgentOutputError) throw new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
        if (err instanceof PermissionDenied) throw new ForbiddenException({ code: 'FORBIDDEN', message: err.message });
        throw err;
      }
      await this.prisma.run(auth, (tx) =>
        tx.meetingRecord.update({
          where: { id },
          data: { analysis: { ...out, actionItems: out.actionItems.map((a) => ({ ...a, taskId: null })) } as unknown as Prisma.InputJsonValue, aiRunId: run.id, analysedAt: new Date(), reviewedAt: null, reviewedById: null },
        }),
      );
      return { output: out, rec: out };
    });
    void analysis;
    return this.get(auth, id);
  }

  /** Creates CRM tasks from the chosen action items of the reviewed reading. Each item becomes at most one task. */
  async createTasks(auth: AuthContext, id: string, indexes: number[], meta: RequestMeta): Promise<MeetingRecord> {
    const r = await this.prisma.run(auth, (tx) => this.find(tx, auth, id));
    const analysis = r.analysis as unknown as MeetingAnalysis | null;
    if (!analysis) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Analyse the meeting first.' });
    if (!r.reviewedAt) throw new ConflictException({ code: 'REVIEW_REQUIRED', message: 'Review and save the meeting summary before creating tasks from it.' });
    const items = analysis.actionItems.map((a) => ({ ...a }));
    const created: string[] = [];
    for (const i of [...new Set(indexes)]) {
      const item = items[i];
      if (!item || item.taskId) continue;
      const task = await this.tasks.create(auth, {
        title: item.title,
        description: `From the meeting "${r.title}" on ${r.occurredAt.toISOString().slice(0, 10)}${item.owner === 'customer' ? '. The customer owns this; follow up to check it is done.' : '.'}`,
        assigneeId: auth.userId,
        dueAt: item.dueInDays !== null ? new Date(r.occurredAt.getTime() + item.dueInDays * DAY).toISOString() : undefined,
        opportunityId: r.dealId ?? undefined,
        contactId: r.contactId ?? undefined,
        leadId: !r.contactId && !r.dealId ? (r.leadId ?? undefined) : undefined,
      }, meta);
      item.taskId = task.id;
      created.push(task.id);
    }
    if (created.length === 0) return this.get(auth, id);
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.meetingRecord.update({
        where: { id },
        data: { analysis: { ...analysis, actionItems: items } as unknown as Prisma.InputJsonValue, taskIds: { push: created } },
        include,
      });
      return this.full(tx, row);
    });
  }

  /** Logs the reviewed summary as a meeting activity on the linked deal, contact or lead. */
  async saveToRecord(auth: AuthContext, id: string, meta: RequestMeta): Promise<MeetingRecord> {
    const r = await this.prisma.run(auth, (tx) => this.find(tx, auth, id));
    const a = r.analysis as unknown as MeetingAnalysis | null;
    if (!a) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Analyse the meeting first.' });
    if (!r.reviewedAt) throw new ConflictException({ code: 'REVIEW_REQUIRED', message: 'Review and save the meeting summary before adding it to the record.' });
    if (!r.dealId && !r.contactId && !r.leadId) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Link the meeting to a deal, contact or lead first.' });
    if (r.activityId) throw new ConflictException({ code: 'ALREADY_SAVED', message: 'This meeting summary is already on the record.' });
    const list = (title: string, xs: string[]) => (xs.length ? `\n\n${title}:\n${xs.map((x) => `- ${x}`).join('\n')}` : '');
    const body = [
      a.summary,
      list('Key points', a.keyPoints),
      list('Requirements', a.requirements),
      list('Objections', a.objections),
      list('Decisions', a.decisions),
      list('Action items', a.actionItems.map((x) => `${x.title} (${x.owner === 'me' ? 'us' : 'customer'})`)),
      list('Commitments', a.commitments.map((c) => `${c.who}: ${c.what}`)),
    ].join('');
    const activity = await this.activities.create(
      auth,
      { type: 'MEETING', subject: r.title.slice(0, 200), body: body.slice(0, 10_000), occurredAt: r.occurredAt.toISOString(), opportunityId: r.dealId ?? undefined, contactId: r.contactId ?? undefined, leadId: r.leadId ?? undefined },
      meta,
      { aiAssisted: true },
    );
    return this.prisma.run(auth, async (tx) => this.full(tx, await tx.meetingRecord.update({ where: { id }, data: { activityId: activity.id }, include })));
  }

  private async find(tx: TenantTx, auth: AuthContext, id: string): Promise<RecordWith> {
    const r = await tx.meetingRecord.findFirst({ where: { id, tenantId: auth.tenantId }, include });
    if (!r) throw notFound('Meeting record');
    return r;
  }

  private async facts(auth: AuthContext, type: RecordType, id: string): Promise<unknown> {
    try {
      return (await this.records.load(auth, type, id)).facts;
    } catch (err) {
      if (err instanceof PermissionDenied) return null;
      throw err;
    }
  }

  private async toRows(tx: TenantTx, rows: RecordWith[]): Promise<MeetingRecordRow[]> {
    const [contacts, leads, users] = await Promise.all([
      tx.contact.findMany({ where: { id: { in: rows.map((r) => r.contactId).filter((v): v is string => !!v) } }, select: { id: true, firstName: true, lastName: true } }),
      tx.lead.findMany({ where: { id: { in: rows.map((r) => r.leadId).filter((v): v is string => !!v) } }, select: { id: true, fullName: true } }),
      ownerRefs(tx, rows.map((r) => r.createdById)),
    ]);
    const cById = new Map(contacts.map((c) => [c.id, { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ') }]));
    const lById = new Map(leads.map((l) => [l.id, { id: l.id, name: l.fullName }]));
    return rows.map((r) => ({
      id: r.id,
      meetingId: r.meetingId,
      title: r.title,
      occurredAt: r.occurredAt.toISOString(),
      contact: r.contactId ? (cById.get(r.contactId) ?? null) : null,
      lead: r.leadId ? (lById.get(r.leadId) ?? null) : null,
      deal: r.deal,
      source: r.source as MeetingRecordRow['source'],
      transcriptionStatus: r.transcriptionStatus as MeetingRecordRow['transcriptionStatus'],
      hasAnalysis: !!r.analysis,
      reviewed: !!r.reviewedAt,
      savedToRecord: !!r.activityId,
      taskCount: r.taskIds.length,
      createdBy: r.createdById ? (users.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async full(tx: TenantTx, r: RecordWith): Promise<MeetingRecord> {
    const [row] = await this.toRows(tx, [r]);
    const users = await ownerRefs(tx, [r.reviewedById, r.recordingConsentById]);
    return {
      ...row!,
      transcript: r.transcript,
      segments: (r.segments as unknown as TranscriptSegment[] | null) ?? null,
      transcriptionProvider: r.transcriptionProvider,
      transcriptionError: r.transcriptionError,
      recordingConsent: r.recordingConsentAt ? { by: r.recordingConsentById ? (users.get(r.recordingConsentById) ?? null) : null, at: r.recordingConsentAt.toISOString() } : null,
      analysis: (r.analysis as unknown as MeetingAnalysis | null) ?? null,
      analysedAt: r.analysedAt?.toISOString() ?? null,
      reviewedBy: r.reviewedById ? (users.get(r.reviewedById) ?? null) : null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      activityId: r.activityId,
      taskIds: r.taskIds,
      attendees: r.meeting?.attendees ?? [],
      joinUrl: r.meeting?.joinUrl ?? null,
    };
  }
}

function targetOf(r: RecordWith): { type: RecordType; id: string } | null {
  if (r.dealId) return { type: 'deal', id: r.dealId };
  if (r.contactId) return { type: 'contact', id: r.contactId };
  if (r.leadId) return { type: 'lead', id: r.leadId };
  return null;
}

function transcriptForAi(r: RecordWith): string {
  const segments = r.segments as unknown as TranscriptSegment[] | null;
  if (segments?.length) return segments.map((s) => `${s.speaker === null ? '' : `Speaker ${s.speaker}: `}${s.text}`).join('\n');
  return (r.transcript ?? '').trim();
}

export function tooLarge(max: number) {
  return new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: `The recording is larger than ${Math.round(max / 1024 / 1024)} MB.` });
}

/** Passes the upload through, failing once more than `max` bytes have arrived. */
export function limitStream(src: ReadableStream<Uint8Array>, max: number): { stream: ReadableStream<Uint8Array>; exceeded: () => boolean } {
  let seen = 0;
  const stream = src.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > max) ctrl.error(new Error('Upload too large'));
        else ctrl.enqueue(chunk);
      },
    }),
  );
  return { stream, exceeded: () => seen > max };
}
