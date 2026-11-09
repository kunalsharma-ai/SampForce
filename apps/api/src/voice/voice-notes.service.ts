import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { z } from 'zod';
import {
  type Permission,
  type VoiceAction,
  type VoiceActionState,
  type VoiceApply,
  voiceActionSchema,
  voiceInterpretationSchema,
  type VoiceLastCall,
  type VoiceLanguage,
  type VoiceNote,
  type VoiceNoteCreate,
  type VoiceRecordType,
} from '@dealflow/types';
import { AgentOutputError, AgentsService } from '../ai/agents.service';
import { PermissionDenied, READ_PERMISSION, RecordContextBuilder } from '../ai/record-context';
import { untrusted } from '../ai/redact';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { ContactsService } from '../crm/contacts.service';
import { LeadsService } from '../crm/leads.service';
import { TasksService } from '../crm/tasks.service';
import { DeepgramClient, TranscriptionError } from '../meetings/deepgram';
import { limitStream, tooLarge } from '../meetings/meeting-records.service';

const DAY = 86_400_000;
/** Each action is checked on its own below, so one malformed action does not throw the rest away. */
const lenient = voiceInterpretationSchema.extend({ actions: z.array(z.record(z.unknown())).max(10) });
/** A dictated note is short; 25 MB is well over half an hour of compressed audio. */
const VOICE_MAX_BYTES = 25 * 1024 * 1024;
const WRITE_PERMISSION: Record<VoiceAction['type'], Permission> = {
  create_task: 'activities:write',
  add_note: 'activities:write',
  create_lead: 'leads:write',
  create_contact: 'contacts:write',
};

type Row = Prisma.VoiceNoteGetPayload<object>;
interface Stored {
  summary: string;
  actions: VoiceActionState[];
  unsupported: string[];
  lastCall: VoiceLastCall | null;
  lastCallMissing: boolean;
}

const recordOf = (r: Row): { type: VoiceRecordType; id: string } | null =>
  r.leadId ? { type: 'lead', id: r.leadId } : r.contactId ? { type: 'contact', id: r.contactId } : r.dealId ? { type: 'deal', id: r.dealId } : r.companyId ? { type: 'company', id: r.companyId } : null;
const linkOf = (type: VoiceRecordType, id: string) => `/app/${type === 'deal' ? 'deals' : type === 'company' ? 'companies' : `${type}s`}/${id}`;

/**
 * Enhancement feature 12: voice-to-CRM. A person dictates (or types) a note, optionally on a record. Recordings are
 * streamed to Deepgram and only the text is kept. The AI proposes tasks, notes, leads and contacts; each is created
 * only when the person confirms it, through the normal CRM services and permission checks. Deleting records,
 * sending email and changing amounts, stages or owners are never done from a voice note.
 */
@Injectable()
export class VoiceNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly records: RecordContextBuilder,
    private readonly deepgram: DeepgramClient,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, record: { type: VoiceRecordType; id: string } | null): Promise<VoiceNote[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.voiceNote.findMany({
        where: { tenantId: auth.tenantId, userId: auth.userId, ...(record ? { [record.type === 'deal' ? 'dealId' : `${record.type}Id`]: record.id } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return Promise.all(rows.map((r) => this.view(tx, r)));
    });
  }

  get(auth: AuthContext, id: string): Promise<VoiceNote> {
    return this.prisma.run(auth, async (tx) => this.view(tx, await this.find(tx, auth, id)));
  }

  async create(auth: AuthContext, input: VoiceNoteCreate, meta: RequestMeta): Promise<VoiceNote> {
    const rec = input.record ?? null;
    if (rec && !auth.permissions.includes(READ_PERMISSION[rec.type])) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot open that record.' });
    return this.prisma.run(auth, async (tx) => {
      if (rec) await this.assertRecord(tx, auth.tenantId, rec);
      const row = await tx.voiceNote.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          language: input.language,
          transcript: input.transcript || null,
          ...(rec ? { [rec.type === 'deal' ? 'dealId' : `${rec.type}Id`]: rec.id } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'voice_note.created', entityType: 'voice_note', entityId: row.id, metadata: { record: rec, typed: !!input.transcript }, meta });
      return this.view(tx, row);
    });
  }

  update(auth: AuthContext, id: string, input: { transcript?: string; language?: VoiceLanguage }): Promise<VoiceNote> {
    return this.prisma.run(auth, async (tx) => {
      const r = await this.find(tx, auth, id);
      const changed = input.transcript !== undefined && input.transcript !== (r.transcript ?? '');
      if (changed && this.stored(r)?.actions.some((a) => a.status === 'applied')) {
        throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'Actions from this note were already saved. Start a new note instead.' });
      }
      const row = await tx.voiceNote.update({
        where: { id },
        // Editing the words throws away the proposals made from the old words.
        data: { ...(input.language ? { language: input.language } : {}), ...(changed ? { transcript: input.transcript || null, interpretation: null, interpretedAt: null } : {}) },
      });
      return this.view(tx, row);
    });
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      await this.find(tx, auth, id);
      await tx.voiceNote.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'voice_note.deleted', entityType: 'voice_note', entityId: id, metadata: {}, meta });
    });
  }

  /** Streams the recording to Deepgram and keeps only the text. The audio is not stored. */
  async transcribe(auth: AuthContext, id: string, upload: { stream: ReadableStream<Uint8Array>; contentType: string; length: number | null; consent: boolean }, meta: RequestMeta): Promise<VoiceNote> {
    if (!upload.consent) throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Confirm that anyone else heard in the recording agreed to it being transcribed.' });
    if (!this.deepgram.configured) {
      throw new ConflictException({ code: 'PENDING_CONFIGURATION', message: 'Transcription is pending configuration: an administrator needs to set DEEPGRAM_API_KEY. You can type the note instead.' });
    }
    if (!/^(audio|video)\/[\w.+-]+$/i.test(upload.contentType)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Upload an audio recording.' });
    if (upload.length !== null && upload.length > VOICE_MAX_BYTES) throw tooLarge(VOICE_MAX_BYTES);
    const language = await this.prisma.run(auth, async (tx) => {
      const r = await this.find(tx, auth, id);
      if (this.stored(r)?.actions.some((a) => a.status === 'applied')) throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'Actions from this note were already saved. Start a new note instead.' });
      await tx.voiceNote.update({ where: { id }, data: { transcriptionStatus: 'processing', transcriptionError: null } });
      return r.language;
    });
    const limited = limitStream(upload.stream, VOICE_MAX_BYTES);
    try {
      const result = await this.deepgram.transcribe(limited.stream, upload.contentType, { language, diarize: false });
      return await this.prisma.run(auth, async (tx) => {
        const row = await tx.voiceNote.update({
          where: { id },
          data: {
            transcript: result.text.slice(0, 50_000), source: 'recording', transcriptionStatus: 'done', transcriptionProvider: 'deepgram', detectedLanguage: result.detectedLanguage,
            durationSeconds: result.durationSeconds, interpretation: null, interpretedAt: null,
          },
        });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'voice_note.transcribed', entityType: 'voice_note', entityId: id, metadata: { provider: 'deepgram', durationSeconds: result.durationSeconds, language, detectedLanguage: result.detectedLanguage }, meta });
        return this.view(tx, row);
      });
    } catch (err) {
      const tooBig = limited.exceeded();
      const message = tooBig ? 'The recording is larger than 25 MB.' : err instanceof TranscriptionError ? err.message : 'Transcription failed.';
      await this.prisma.run(auth, (tx) => tx.voiceNote.update({ where: { id }, data: { transcriptionStatus: 'failed', transcriptionError: message } }));
      if (tooBig) throw tooLarge(VOICE_MAX_BYTES);
      throw new UnprocessableEntityException({ code: 'TRANSCRIPTION_FAILED', message });
    }
  }

  /** Asks the AI what the note wants done. The answer is a proposal; nothing is created here. */
  async interpret(auth: AuthContext, id: string, today: string): Promise<VoiceNote> {
    const r = await this.prisma.run(auth, (tx) => this.find(tx, auth, id));
    const text = (r.transcript ?? '').trim();
    if (text.length < 3) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Dictate or type the note first.' });
    if (this.stored(r)?.actions.some((a) => a.status === 'applied')) throw new ConflictException({ code: 'ALREADY_APPLIED', message: 'Actions from this note were already saved. Start a new note instead.' });
    const rec = recordOf(r);
    const facts = rec ? await this.facts(auth, rec) : null;
    const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    await this.agents.withRun(auth, 'voice_assistant', rec?.type ?? null, rec?.id ?? null, { op: 'voice_note', noteId: id, length: text.length }, undefined, async (run) => {
      let out: z.infer<typeof lenient>;
      try {
        out = await this.agents.structured(auth, run, 'voice_assistant', 'voiceNote', lenient, {
          today,
          weekday,
          record: rec ? { type: rec.type, ...(facts ?? {}) } : null,
          note: untrusted('voice_note', text),
        });
      } catch (err) {
        if (err instanceof AgentOutputError) throw new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
        if (err instanceof PermissionDenied) throw new ForbiddenException({ code: 'FORBIDDEN', message: err.message });
        throw err;
      }
      const stored: Stored = {
        summary: out.summary,
        // An action that does not fit the rules is dropped and named, instead of failing the whole note.
        actions: out.actions.flatMap((a) => {
          const p = voiceActionSchema.safeParse(a);
          return p.success ? [checkAction(p.data, text, today, rec)] : [];
        }),
        unsupported: [...out.unsupported, ...out.actions.filter((a) => !voiceActionSchema.safeParse(a).success).map(() => 'One proposed action was incomplete and was left out')].slice(0, 10),
        lastCall: null,
        lastCallMissing: false,
      };
      if (out.lastCallRequested) {
        stored.lastCall = await this.prisma.run(auth, (tx) => this.lastCall(tx, auth, rec));
        stored.lastCallMissing = !stored.lastCall;
      }
      await this.prisma.run(auth, (tx) => tx.voiceNote.update({ where: { id }, data: { interpretation: stored as unknown as Prisma.InputJsonValue, aiRunId: run.id, interpretedAt: new Date() } }));
      return { output: out, rec: stored };
    });
    return this.get(auth, id);
  }

  /**
   * Creates the actions the person confirmed, with their edits. Each one goes through the same service and
   * permission check as the CRM screens. An action is created at most once.
   */
  async apply(auth: AuthContext, id: string, input: VoiceApply, meta: RequestMeta): Promise<VoiceNote> {
    const r = await this.prisma.run(auth, (tx) => this.find(tx, auth, id));
    const stored = this.stored(r);
    if (!stored) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Work out the actions first.' });
    const rec = recordOf(r);
    for (const item of input.items) {
      const state = stored.actions[item.index];
      if (!state) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `There is no proposed action ${item.index + 1}.` });
      if (state.status === 'applied') throw new ConflictException({ code: 'ALREADY_APPLIED', message: `Action ${item.index + 1} was already saved.` });
      if (state.action.type !== item.action.type) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `Action ${item.index + 1} cannot change its kind.` });
      const need = WRITE_PERMISSION[item.action.type];
      if (!auth.permissions.includes(need)) throw new ForbiddenException({ code: 'FORBIDDEN', message: `Your role cannot do this (${need}).` });
      if (item.action.type === 'add_note' && !rec) throw new BadRequestException({ code: 'NEEDS_RECORD', message: 'A note needs a record. Make the voice note from a lead, contact, deal or company.' });
    }
    const done: string[] = [];
    for (const item of input.items) {
      const state = stored.actions[item.index]!;
      state.action = item.action;
      state.result = await this.createOne(auth, item.action, rec, input.timezoneOffsetMinutes, state, meta);
      state.status = 'applied';
      done.push(item.action.type);
      // Saved after each one, so a later failure never loses what was already created.
      await this.prisma.run(auth, (tx) => tx.voiceNote.update({ where: { id }, data: { interpretation: stored as unknown as Prisma.InputJsonValue, appliedAt: new Date() } }));
    }
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'voice_note.applied', entityType: 'voice_note', entityId: id, metadata: { actions: done, record: rec }, meta }),
    );
    return this.get(auth, id);
  }

  private async createOne(auth: AuthContext, a: VoiceAction, rec: { type: VoiceRecordType; id: string } | null, tzOffset: number, state: VoiceActionState, meta: RequestMeta): Promise<VoiceActionState['result']> {
    switch (a.type) {
      case 'create_task': {
        let dueAt: string | undefined;
        if (a.dueDate) {
          const [h, m] = (a.dueTime ?? '09:00').split(':').map(Number) as [number, number];
          const [y, mo, d] = a.dueDate.split('-').map(Number) as [number, number, number];
          dueAt = new Date(Date.UTC(y, mo - 1, d, h, m) + tzOffset * 60_000).toISOString();
        }
        const company = rec?.type === 'company' ? await this.prisma.run(auth, (tx) => tx.company.findFirst({ where: { id: rec.id }, select: { name: true } })) : null;
        const notes = [
          'From a voice note.',
          a.meeting ? 'A meeting to arrange: SampForce does not send calendar invitations from voice notes.' : null,
          company ? `For ${company.name}.` : null,
        ].filter(Boolean).join(' ');
        const t = await this.tasks.create(auth, {
          title: a.title,
          description: notes,
          dueAt,
          assigneeId: auth.userId,
          leadId: rec?.type === 'lead' ? rec.id : undefined,
          contactId: rec?.type === 'contact' ? rec.id : undefined,
          opportunityId: rec?.type === 'deal' ? rec.id : undefined,
        }, meta);
        return { type: 'task', id: t.id, link: rec ? linkOf(rec.type, rec.id) : '/app/activities' };
      }
      case 'add_note': {
        const act = await this.activities.create(auth, {
          type: 'NOTE',
          subject: `Voice note: ${a.body.replace(/\s+/g, ' ').slice(0, 80)}`.slice(0, 200),
          body: a.body,
          leadId: rec?.type === 'lead' ? rec.id : undefined,
          contactId: rec?.type === 'contact' ? rec.id : undefined,
          opportunityId: rec?.type === 'deal' ? rec.id : undefined,
          companyId: rec?.type === 'company' ? rec.id : undefined,
        }, meta, { aiAssisted: true });
        return { type: 'activity', id: act.id, link: linkOf(rec!.type, rec!.id) };
      }
      case 'create_lead': {
        const { lead, duplicates } = await this.leads.create(auth, { fullName: a.name, companyName: a.company ?? undefined, email: a.email ?? undefined, phone: a.phone ?? undefined, source: 'Voice note' }, meta);
        if (duplicates.length) state.warnings.push(`Possible duplicate of ${duplicates.length} existing record${duplicates.length === 1 ? '' : 's'}; check the lead.`);
        return { type: 'lead', id: lead.id, link: `/app/leads/${lead.id}` };
      }
      case 'create_contact': {
        const companyId =
          rec?.type === 'company' ? rec.id : rec?.type === 'deal' ? ((await this.prisma.run(auth, (tx) => tx.opportunity.findFirst({ where: { id: rec.id }, select: { companyId: true } })))?.companyId ?? undefined) : undefined;
        const c = await this.contacts.create(auth, { firstName: a.firstName, lastName: a.lastName ?? undefined, jobTitle: a.jobTitle ?? undefined, email: a.email ?? undefined, phone: a.phone ?? undefined, companyId }, meta);
        return { type: 'contact', id: c.id, link: `/app/contacts/${c.id}` };
      }
    }
  }

  /** The newest summary on file for the record (or for the person, without a record). Never generated here. */
  private async lastCall(tx: TenantTx, auth: AuthContext, rec: { type: VoiceRecordType; id: string } | null): Promise<VoiceLastCall | null> {
    const t = auth.tenantId;
    const mrWhere: Prisma.MeetingRecordWhereInput = rec
      ? rec.type === 'deal' ? { dealId: rec.id } : rec.type === 'contact' ? { contactId: rec.id } : rec.type === 'lead' ? { leadId: rec.id } : { deal: { companyId: rec.id } }
      : { createdById: auth.userId };
    const mr = auth.permissions.includes('activities:read')
      ? await tx.meetingRecord.findFirst({ where: { tenantId: t, analysis: { not: null }, ...mrWhere }, orderBy: { occurredAt: 'desc' }, select: { id: true, title: true, occurredAt: true, analysis: true } })
      : null;
    const actWhere: Prisma.ActivityWhereInput = rec ? { [rec.type === 'deal' ? 'opportunityId' : `${rec.type}Id`]: rec.id } : { ownerId: auth.userId };
    const act = auth.permissions.includes('activities:read')
      ? await tx.activity.findFirst({ where: { tenantId: t, deletedAt: null, type: { in: ['CALL', 'MEETING'] }, occurredAt: { lte: new Date() }, ...actWhere }, orderBy: { occurredAt: 'desc' }, select: { id: true, subject: true, body: true, occurredAt: true, leadId: true, contactId: true, companyId: true, opportunityId: true } })
      : null;
    if (mr && (!act || mr.occurredAt >= act.occurredAt)) {
      const summary = (mr.analysis as { summary?: string } | null)?.summary;
      if (summary) return { title: mr.title, occurredAt: mr.occurredAt.toISOString(), summary, link: `/app/meetings/records/${mr.id}`, source: 'meeting_record' };
    }
    if (!act) return null;
    const on = act.opportunityId ? linkOf('deal', act.opportunityId) : act.contactId ? linkOf('contact', act.contactId) : act.leadId ? linkOf('lead', act.leadId) : act.companyId ? linkOf('company', act.companyId) : '/app/activities';
    return { title: act.subject, occurredAt: act.occurredAt.toISOString(), summary: act.body?.slice(0, 1500) || 'No notes were written for this call.', link: on, source: 'activity' };
  }

  private async assertRecord(tx: TenantTx, tenantId: string, rec: { type: VoiceRecordType; id: string }): Promise<void> {
    const where = { id: rec.id, tenantId, deletedAt: null };
    const found =
      rec.type === 'lead' ? await tx.lead.findFirst({ where, select: { id: true } })
      : rec.type === 'contact' ? await tx.contact.findFirst({ where, select: { id: true } })
      : rec.type === 'deal' ? await tx.opportunity.findFirst({ where, select: { id: true } })
      : await tx.company.findFirst({ where, select: { id: true } });
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Record not found.' });
  }

  private async facts(auth: AuthContext, rec: { type: VoiceRecordType; id: string }): Promise<Record<string, unknown> | null> {
    try {
      return (await this.records.load(auth, rec.type, rec.id)).facts;
    } catch (err) {
      if (err instanceof PermissionDenied) return null;
      throw err;
    }
  }

  private async find(tx: TenantTx, auth: AuthContext, id: string): Promise<Row> {
    // Voice notes are personal: only the person who made one can open it.
    const r = await tx.voiceNote.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Voice note not found.' });
    return r;
  }

  private stored(r: Row): Stored | null {
    return (r.interpretation as unknown as Stored | null) ?? null;
  }

  private async view(tx: TenantTx, r: Row): Promise<VoiceNote> {
    const rec = recordOf(r);
    let name: string | null = null;
    if (rec) {
      if (rec.type === 'lead') name = (await tx.lead.findFirst({ where: { id: rec.id }, select: { fullName: true } }))?.fullName ?? null;
      else if (rec.type === 'contact') {
        const c = await tx.contact.findFirst({ where: { id: rec.id }, select: { firstName: true, lastName: true } });
        name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : null;
      } else if (rec.type === 'deal') name = (await tx.opportunity.findFirst({ where: { id: rec.id }, select: { name: true } }))?.name ?? null;
      else name = (await tx.company.findFirst({ where: { id: rec.id }, select: { name: true } }))?.name ?? null;
    }
    const s = this.stored(r);
    return {
      id: r.id,
      source: r.source as VoiceNote['source'],
      language: r.language as VoiceLanguage,
      detectedLanguage: r.detectedLanguage,
      transcript: r.transcript,
      durationSeconds: r.durationSeconds?? null,
      transcriptionStatus: r.transcriptionStatus as VoiceNote['transcriptionStatus'],
      transcriptionError: r.transcriptionError,
      record: rec && name !== null ? { ...rec, name } : null,
      summary: s?.summary ?? null,
      actions: s?.actions ?? [],
      unsupported: s?.unsupported ?? [],
      lastCall: s?.lastCall ?? null,
      lastCallMissing: s?.lastCallMissing ?? false,
      interpretedAt: r.interpretedAt?.toISOString() ?? null,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

/**
 * Checks one proposed action against the note: an email or phone number that was not said is removed, and a date
 * that is not real or is far from today is cleared. The person sees why.
 */
export function checkAction(raw: VoiceAction, note: string, today: string, rec: { type: VoiceRecordType } | null): VoiceActionState {
  const warnings: string[] = [];
  const a = { ...raw } as VoiceAction;
  const lower = note.toLowerCase();
  const digits = note.replace(/\D/g, '');
  if ((a.type === 'create_lead' || a.type === 'create_contact') && a.email && !lower.includes(a.email.toLowerCase())) {
    warnings.push(`Removed the email ${a.email}: it was not in the note.`);
    a.email = null;
  }
  if ((a.type === 'create_lead' || a.type === 'create_contact') && a.phone) {
    const d = a.phone.replace(/\D/g, '');
    if (d.length < 5 || !digits.includes(d)) {
      warnings.push(`Removed the phone number ${a.phone}: it was not in the note.`);
      a.phone = null;
    }
  }
  if (a.type === 'create_task' && a.dueDate) {
    const due = Date.parse(`${a.dueDate}T00:00:00Z`);
    const base = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(due) || due < base - DAY || due > base + 400 * DAY) {
      warnings.push(`Cleared the date ${a.dueDate}: it does not look right. Pick one.`);
      a.dueDate = null;
      a.dueTime = null;
    }
  }
  if (a.type === 'add_note' && !rec) warnings.push('A note needs a record. Make the voice note from a lead, contact, deal or company to save it.');
  return { action: a, status: 'proposed', warnings, result: null };
}
