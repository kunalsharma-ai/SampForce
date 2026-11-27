import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { deleteAllCountSchema, deleteAllSchema, type DeleteAllInput, callListQuerySchema, callLogSchema, callStartSchema, callTargetSearchSchema, callUpdateSchema, dialerInputSchema } from '@dealflow/types';
import { z } from 'zod';
import { AlsoRequireFeature, Auth, type AuthContext, Meta, Public, type RequestMeta, RequireAction, RequirePermissions } from '../common/auth-context';
import { ConfirmPassword, NoPasswordConfirmation } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { CallsService } from './calls.service';

const uuid = new ParseUUIDPipe();
const detailsQuery = callStartSchema.innerType().pick({ companyId: true, contactId: true });
const tzQuery = z.object({ tz: z.string().trim().max(64).optional() });

/** Twilio posts application/x-www-form-urlencoded; the signature covers exactly these name/value pairs. */
function formParams(req: RawBodyRequest<Request>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!req.rawBody || !String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) return out;
  for (const [k, v] of new URLSearchParams(req.rawBody.toString('utf8'))) out[k] = v;
  return out;
}

/** The Calls section (ADR 0088). Calls are logged as company interactions, so the section follows that plan feature. */
@Controller('calls')
@AlsoRequireFeature('interactions')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** Delete every record this list shows for its filters, with no limit (ADR 0096). */
  @ConfirmPassword()
  @Post('delete-all')
  @HttpCode(200)
  @RequireAction('delete')
  @RequirePermissions('activities:write')
  deleteAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllSchema)) body: DeleteAllInput, @Meta() meta: RequestMeta) {
    return this.calls.deleteAll(auth, body, meta);
  }

  /** How many records "delete all" would delete for this list query, shown before the person confirms. */
  @Post('delete-all/count')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  async countAll(@Auth() auth: AuthContext, @Body(new ZodPipe(deleteAllCountSchema)) body: { query: Record<string, string> }) {
    return { count: (await this.calls.matchingIds(auth, body.query)).length };
  }

  @Get('dialers')
  @RequirePermissions('activities:read')
  dialers(@Auth() auth: AuthContext) {
    return this.calls.settings(auth);
  }

  @Post('dialers')
  @RequirePermissions('activities:write')
  createDialer(@Auth() auth: AuthContext, @Body(new ZodPipe(dialerInputSchema)) body: z.output<typeof dialerInputSchema>, @Meta() meta: RequestMeta) {
    return this.calls.createDialer(auth, body, meta);
  }

  @Put('dialers/:id')
  @RequirePermissions('activities:write')
  updateDialer(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dialerInputSchema)) body: z.output<typeof dialerInputSchema>, @Meta() meta: RequestMeta) {
    return this.calls.updateDialer(auth, id, body, meta);
  }

  @Post('dialers/:id/secret')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  renewSecret(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.calls.renewSecret(auth, id, meta);
  }

  @NoPasswordConfirmation('A personal dialer setting; calls placed with it stay in the history')
  @Delete('dialers/:id')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  removeDialer(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.calls.removeDialer(auth, id, meta);
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
