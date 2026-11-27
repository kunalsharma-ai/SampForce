import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { deleteAllCountSchema, deleteAllSchema, type DeleteAllInput, meetingRecordCreateSchema, type MeetingRecordCreate, meetingRecordUpdateSchema, type MeetingRecordUpdate, meetingTasksSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature, RequireAction } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { meetingRecordListQuerySchema, MeetingRecordsService } from './meeting-records.service';
import { ConfirmPassword } from '../common/password-confirmation';

const listQuery = meetingRecordListQuerySchema;
const uuid = new ParseUUIDPipe();

/** Enhancement feature 7: meeting notes, transcripts and recordings turned into reviewed CRM information. */
@Controller('meeting-records')
@RequireFeature('meeting_intelligence')
export class MeetingRecordsController {
  constructor(private readonly meetings: MeetingRecordsService) {}

  /** Delete every record this list shows for its filters, on every page, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.meetings.deleteAll(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.meetings.matchingIds(auth, body.query)).length };
  }


  @Get()
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.meetings.list(auth, q);
  }

  @Get('transcription-status')
  @RequirePermissions('activities:read')
  status(@Auth() auth: AuthContext) {
    return this.meetings.transcriptionStatus(auth);
  }

  @Post()
  @RequirePermissions('activities:write')
  async create(@Auth() auth: AuthContext, @Body(new ZodPipe(meetingRecordCreateSchema)) body: MeetingRecordCreate, @Meta() meta: RequestMeta) {
    return (await this.meetings.create(auth, body, meta)).record;
  }

  @Get(':id')
  @RequirePermissions('activities:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.meetings.get(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(meetingRecordUpdateSchema)) body: MeetingRecordUpdate, @Meta() meta: RequestMeta) {
    return this.meetings.update(auth, id, body, meta);
  }

  @ConfirmPassword()
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.meetings.remove(auth, id, meta);
  }

  /** The request body is the recording itself (Content-Type audio/* or video/*), streamed to the transcription service. */
  @Post(':id/recording')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  recording(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('consent') consent: string | undefined, @Req() req: Request, @Meta() meta: RequestMeta) {
    const length = req.headers['content-length'] ? Number(req.headers['content-length']) : null;
    return this.meetings.transcribe(
      auth,
      id,
      { stream: Readable.toWeb(req) as ReadableStream<Uint8Array>, contentType: String(req.headers['content-type'] ?? '').split(';')[0]!.trim(), length: Number.isFinite(length) ? length : null, consent: consent === 'true' },
      meta,
    );
  }

  @Post(':id/analyse')
  @HttpCode(200)
  @RequirePermissions('activities:write', 'ai:use')
  analyse(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.meetings.analyse(auth, id);
  }

  @Post(':id/tasks')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  tasks(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(meetingTasksSchema)) body: { indexes: number[] }, @Meta() meta: RequestMeta) {
    return this.meetings.createTasks(auth, id, body.indexes, meta);
  }

  @Post(':id/save')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  save(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.meetings.saveToRecord(auth, id, meta);
  }
}
