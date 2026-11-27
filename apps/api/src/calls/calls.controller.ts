import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  callControlSchema,
  callListQuerySchema,
  callLogSchema,
  callOutcomeInputSchema,
  callStartSchema,
  callTargetSearchSchema,
  callUpdateSchema,
  dialerInputSchema,
  RECORDING_MAX_BYTES,
  recordingListQuerySchema,
  recordingNoteSchema,
  recordingPolicySchema,
} from '@dealflow/types';
import { z } from 'zod';
import { AlsoRequireFeature, Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { NoPasswordConfirmation } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { contentDisposition } from '../portal/portal-documents';
import { CallsService } from './calls.service';
import { callError, DialersService } from './dialers.service';

const uuid = new ParseUUIDPipe();
const detailsQuery = callStartSchema.innerType().pick({ companyId: true, contactId: true });
const tzQuery = z.object({ tz: z.string().trim().max(64).optional() });
const activeBody = z.object({ active: z.boolean() });
const favoriteBody = detailsQuery.extend({ on: z.boolean() });
const outcomeKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/);
const recordingUpload = z.object({ source: z.enum(['UPLOAD', 'BROWSER']).default('UPLOAD'), durationSec: z.coerce.number().int().min(0).max(86_400).optional() });

/** Twilio and many providers post application/x-www-form-urlencoded; the signature covers exactly these pairs. */
function formParams(req: RawBodyRequest<Request>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!req.rawBody || !String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) return out;
  for (const [k, v] of new URLSearchParams(req.rawBody.toString('utf8'))) out[k] = v;
  return out;
}

/** A recording's bytes, streamed past the JSON parser (12 MB at most). */
async function readAudio(req: Request): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > RECORDING_MAX_BYTES) throw callError('Recordings can be up to 12 MB.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > RECORDING_MAX_BYTES) throw callError('Recordings can be up to 12 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Sends audio with byte ranges, so the player can seek. */
function sendAudio(req: Request, res: Response, audio: { data: Buffer; contentType: string; name: string }, download: boolean) {
  res.setHeader('Content-Type', audio.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (download) res.setHeader('Content-Disposition', contentDisposition(audio.name));
  const total = audio.data.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      return res.end();
    }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return res.end(audio.data.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', String(total));
  return res.end(audio.data);
}

/** The Calls section (ADR 0088). Calls are logged as company interactions, so the section follows that plan feature. */
@Controller('calls')
@AlsoRequireFeature('interactions')
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly dialerSvc: DialersService,
  ) {}

  @Get('dialers')
  @RequirePermissions('activities:read')
  dialers(@Auth() auth: AuthContext) {
    return this.dialerSvc.settings(auth);
  }

  @Post('dialers')
  @RequirePermissions('activities:write')
  createDialer(@Auth() auth: AuthContext, @Body(new ZodPipe(dialerInputSchema)) body: z.output<typeof dialerInputSchema>, @Meta() meta: RequestMeta) {
    return this.dialerSvc.createDialer(auth, body, meta);
  }

  @Put('dialers/:id')
  @RequirePermissions('activities:write')
  updateDialer(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dialerInputSchema)) body: z.output<typeof dialerInputSchema>, @Meta() meta: RequestMeta) {
    return this.dialerSvc.updateDialer(auth, id, body, meta);
  }

  @Post('dialers/:id/secret')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  renewSecret(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.dialerSvc.renewSecret(auth, id, meta);
  }

  @NoPasswordConfirmation('A personal dialer setting; calls placed with it stay in the history')
  @Delete('dialers/:id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  removeDialer(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.dialerSvc.removeDialer(auth, id, meta);
  }

  @Post('dialers/:id/active')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  setActive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(activeBody)) body: { active: boolean }, @Meta() meta: RequestMeta) {
    return this.dialerSvc.setActive(auth, id, body.active, meta);
  }

  @Post('dialers/:id/default')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  makeDefault(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.dialerSvc.makeDefault(auth, id, meta);
  }

  @Post('dialers/:id/events-address')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  renewEvents(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.dialerSvc.renewEvents(auth, id, meta);
  }

  @Post('dialers/:id/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  testDialer(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.dialerSvc.test(auth, id, meta);
  }

  @Get('dialers/:id/logs')
  @RequirePermissions('activities:read')
  dialerLogs(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.dialerSvc.logs(auth, id);
  }

  // ─── Workspace call settings: outcomes and the recording policy ───

  @Get('outcomes')
  @RequirePermissions('activities:read')
  outcomes(@Auth() auth: AuthContext) {
    return this.calls.outcomes(auth);
  }

  @Post('outcomes')
  @RequirePermissions('crm:configure')
  addOutcome(@Auth() auth: AuthContext, @Body(new ZodPipe(callOutcomeInputSchema)) body: z.output<typeof callOutcomeInputSchema>, @Meta() meta: RequestMeta) {
    return this.calls.addOutcome(auth, body, meta);
  }

  @Put('outcomes/:key')
  @RequirePermissions('crm:configure')
  saveOutcome(@Auth() auth: AuthContext, @Param('key', new ZodPipe(outcomeKey)) key: string, @Body(new ZodPipe(callOutcomeInputSchema)) body: z.output<typeof callOutcomeInputSchema>, @Meta() meta: RequestMeta) {
    return this.calls.saveOutcome(auth, key, body, meta);
  }

  @NoPasswordConfirmation('A workspace outcome; calls logged with it keep it')
  @Delete('outcomes/:key')
  @RequirePermissions('crm:configure')
  removeOutcome(@Auth() auth: AuthContext, @Param('key', new ZodPipe(outcomeKey)) key: string, @Meta() meta: RequestMeta) {
    return this.calls.removeOutcome(auth, key, meta);
  }

  @Get('recording-policy')
  @RequirePermissions('activities:read')
  policy(@Auth() auth: AuthContext) {
    return this.dialerSvc.policy(auth);
  }

  @Put('recording-policy')
  @RequirePermissions('crm:configure')
  setPolicy(@Auth() auth: AuthContext, @Body(new ZodPipe(recordingPolicySchema)) body: z.output<typeof recordingPolicySchema>, @Meta() meta: RequestMeta) {
    return this.dialerSvc.setPolicy(auth, body, meta);
  }

  // ─── Favourites ───

  @Get('favorites')
  @RequirePermissions('activities:read')
  favorites(@Auth() auth: AuthContext) {
    return this.calls.favorites(auth);
  }

  @Post('favorites')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  async setFavorite(@Auth() auth: AuthContext, @Body(new ZodPipe(favoriteBody)) body: z.output<typeof favoriteBody>) {
    await this.calls.setFavorite(auth, body, body.on);
  }

  @Post('number-flag/clear')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  async clearFlag(@Auth() auth: AuthContext, @Body(new ZodPipe(detailsQuery)) body: z.output<typeof detailsQuery>, @Meta() meta: RequestMeta) {
    await this.calls.clearFlag(auth, body, meta);
  }

  // ─── Recordings ───

  @Get('recordings')
  @RequirePermissions('activities:read')
  recordings(@Auth() auth: AuthContext, @Query(new ZodPipe(recordingListQuerySchema)) q: z.output<typeof recordingListQuerySchema>) {
    return this.calls.recordings(auth, q);
  }

  @Get('recordings/:id/audio')
  @RequirePermissions('activities:read')
  async audio(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('download') download: string | undefined, @Req() req: Request, @Res() res: Response) {
    const audio = await this.calls.recordingAudio(auth, id, download === '1');
    sendAudio(req, res, audio, download === '1');
  }

  @Patch('recordings/:id')
  @RequirePermissions('activities:write')
  recordingNotes(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(recordingNoteSchema)) body: z.output<typeof recordingNoteSchema>, @Meta() meta: RequestMeta) {
    return this.calls.setRecordingNotes(auth, id, body.notes, meta);
  }

  @NoPasswordConfirmation('One call recording')
  @Delete('recordings/:id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  removeRecording(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.calls.removeRecording(auth, id, meta);
  }

  @Get('search')
  @RequirePermissions('companies:read', 'contacts:read')
  search(@Auth() auth: AuthContext, @Query(new ZodPipe(callTargetSearchSchema)) q: z.output<typeof callTargetSearchSchema>) {
    return this.calls.search(auth, q.q);
  }

  @Get('details')
  @RequirePermissions('companies:read', 'contacts:read')
  details(@Auth() auth: AuthContext, @Query(new ZodPipe(detailsQuery)) q: z.output<typeof detailsQuery>) {
    return this.calls.details(auth, q);
  }

  @Get('stats')
  @RequirePermissions('activities:read')
  stats(@Auth() auth: AuthContext, @Query(new ZodPipe(tzQuery)) q: { tz?: string }) {
    return this.calls.stats(auth, safeTz(q.tz));
  }

  @Get()
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(callListQuerySchema)) q: z.output<typeof callListQuerySchema>) {
    return this.calls.list(auth, q);
  }

  @Get(':id')
  @RequirePermissions('activities:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.calls.get(auth, id);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions('activities:write')
  start(@Auth() auth: AuthContext, @Body(new ZodPipe(callStartSchema)) body: z.output<typeof callStartSchema>, @Meta() meta: RequestMeta) {
    return this.calls.start(auth, body, meta);
  }

  @Post(':id/log')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  log(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(callLogSchema)) body: z.output<typeof callLogSchema>, @Meta() meta: RequestMeta) {
    return this.calls.log(auth, id, body, meta);
  }

  @Post(':id/control')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  control(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(callControlSchema)) body: z.output<typeof callControlSchema>, @Meta() meta: RequestMeta) {
    return this.calls.control(auth, id, body, meta);
  }

  @Post(':id/consent')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  consent(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.calls.consent(auth, id, meta);
  }

  /** A recording of the call: the audio file is the request body, its type the Content-Type. */
  @Post(':id/recordings')
  @RequirePermissions('activities:write')
  async addRecording(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query(new ZodPipe(recordingUpload)) q: z.output<typeof recordingUpload>, @Req() req: Request, @Meta() meta: RequestMeta) {
    const contentType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    return this.calls.addRecording(auth, id, { data: await readAudio(req), contentType, source: q.source, durationSec: q.durationSec ?? null }, meta);
  }

  @Patch(':id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(callUpdateSchema)) body: z.output<typeof callUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.calls.update(auth, id, body, meta);
  }

  @NoPasswordConfirmation('Only a call that was never logged, placed by mistake')
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  discard(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.calls.discard(auth, id, meta);
  }
}

/**
 * A cloud dialer's events address (ADR 0089): the provider posts call status, talk time, recordings and incoming calls
 * here, as JSON or a form. The secret part of the address proves it is the dialer's provider.
 */
@Controller('calls/events')
export class CallsEventsController {
  constructor(private readonly calls: CallsService) {}

  @Post(':hookId/:token')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  event(@Param('hookId') hookId: string, @Param('token') token: string, @Req() req: RawBodyRequest<Request>, @Body() body: unknown) {
    const form = formParams(req);
    const data = Object.keys(form).length ? form : body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    return this.calls.providerEvent(hookId, token, data);
  }
}

/** Twilio's status callbacks for calls placed through the workspace's Twilio number (signed with X-Twilio-Signature). */
@Controller('calls/twilio')
export class CallsTwilioController {
  constructor(private readonly calls: CallsService) {}

  @Post(':hookId/:callId')
  @Public()
  @SkipThrottle()
  @HttpCode(204)
  async status(@Param('hookId') hookId: string, @Param('callId') callId: string, @Query('leg') leg: string, @Req() req: RawBodyRequest<Request>, @Headers('x-twilio-signature') signature?: string) {
    await this.calls.twilioStatus(hookId, callId, leg ?? '', formParams(req), signature);
  }
}

function safeTz(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
