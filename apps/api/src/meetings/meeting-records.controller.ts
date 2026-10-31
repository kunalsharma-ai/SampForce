import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { meetingRecordCreateSchema, type MeetingRecordCreate, meetingRecordUpdateSchema, type MeetingRecordUpdate, meetingTasksSchema, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { MeetingRecordsService } from './meeting-records.service';

const listQuery = z.object({ dealId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), leadId: z.string().uuid().optional() });
const uuid = new ParseUUIDPipe();

/** Enhancement feature 7: meeting notes, transcripts and recordings turned into reviewed CRM information. */
@Controller('meeting-records')
export class MeetingRecordsController {
  constructor(private readonly meetings: MeetingRecordsService) {}

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
