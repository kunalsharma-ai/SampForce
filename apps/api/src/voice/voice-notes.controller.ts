import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import {
  deleteAllCountSchema,
  deleteAllSchema,
  type DeleteAllInput,
  type TranscriptionStatus,
  type VoiceApply,
  voiceApplySchema,
  type VoiceLanguage,
  type VoiceNote,
  type VoiceNoteCreate,
  voiceNoteCreateSchema,
  voiceNoteUpdateSchema,
  voiceInterpretSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature, RequireAction } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { MeetingRecordsService } from '../meetings/meeting-records.service';
import { voiceNoteListQuerySchema, VoiceNotesService } from './voice-notes.service';
import { ConfirmPassword } from '../common/password-confirmation';

const listQuery = voiceNoteListQuerySchema;
const uuid = new ParseUUIDPipe();

/** Enhancement feature 12: voice notes turned into CRM actions the person confirms (ADR 0026). */
@Controller('voice-notes')
@RequireFeature('voice_notes')
export class VoiceNotesController {
  constructor(
    private readonly voice: VoiceNotesService,
    private readonly meetings: MeetingRecordsService,
  ) {}

  /** Delete every record this list shows for its filters, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.voice.deleteAll(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('count-all')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.voice.matchingIds(auth, body.query)).length };
  }

  @Get()
  @RequirePermissions('activities:write')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>): Promise<VoiceNote[]> {
    return this.voice.list(auth, q.type && q.id ? { type: q.type, id: q.id } : null);
  }

  /** Same state as meeting transcription: one Deepgram key serves both. */
  @Get('transcription-status')
  @RequirePermissions('activities:write')
  status(@Auth() auth: AuthContext): Promise<TranscriptionStatus> {
    return this.meetings.transcriptionStatus(auth).then((s) => ({ ...s, maxUploadMb: 25 }));
  }

  @Post()
  @RequirePermissions('activities:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(voiceNoteCreateSchema)) body: VoiceNoteCreate, @Meta() meta: RequestMeta): Promise<VoiceNote> {
    return this.voice.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('activities:write')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string): Promise<VoiceNote> {
    return this.voice.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(voiceNoteUpdateSchema)) body: { transcript?: string; language?: VoiceLanguage }): Promise<VoiceNote> {
    return this.voice.update(auth, id, body);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta): Promise<void> {
    return this.voice.remove(auth, id, meta);
  }

  @Post(':id/recording')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  recording(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('consent') consent: string | undefined, @Req() req: Request, @Meta() meta: RequestMeta): Promise<VoiceNote> {
    const length = req.headers['content-length'] ? Number(req.headers['content-length']) : null;
    return this.voice.transcribe(
      auth,
      id,
      { stream: Readable.toWeb(req) as ReadableStream<Uint8Array>, contentType: String(req.headers['content-type'] ?? '').split(';')[0]!.trim(), length: Number.isFinite(length) ? length : null, consent: consent === 'true' },
      meta,
    );
  }

  @Post(':id/interpret')
  @HttpCode(200)
  @RequirePermissions('activities:write', 'ai:use')
  interpret(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(voiceInterpretSchema)) body: { today: string }): Promise<VoiceNote> {
    return this.voice.interpret(auth, id, body.today);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  apply(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(voiceApplySchema)) body: VoiceApply, @Meta() meta: RequestMeta): Promise<VoiceNote> {
    return this.voice.apply(auth, id, body, meta);
  }
}
