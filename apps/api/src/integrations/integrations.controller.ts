import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type InboxQuery, inboxNoteSchema, inboxQuerySchema, type InboxUpdate, inboxUpdateSchema, sendEmailSchema, type SendEmailInput, z } from '@dealflow/types';
import { Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { ZodPipe } from '../common/zod.pipe';
import { CommunicationService } from './communication.service';
import { InboxService } from './inbox.service';
import { IntegrationsService } from './integrations.service';

const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().max(4000).optional(), error: z.string().max(200).optional() });
const emailQuery = z.object({
  contactId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const meetingQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  contactId: z.string().uuid().optional(),
});

/** Each member connects their own mailbox and calendar. */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get()
  @RequirePermissions('activities:read')
  status(@Auth() auth: AuthContext) {
    return this.integrations.status(auth);
  }

  @Post(':provider/connect')
  @RequireFeature('email_sync')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  connect(@Auth() auth: AuthContext, @Param('provider') provider: string) {
    return this.integrations.connectUrl(auth, IntegrationsService.parseProvider(provider));
  }

  /** OAuth redirect target. Always lands the browser back on the integrations page with an outcome. */
  @Get(':provider/callback')
  @RequireFeature('email_sync')
  @RequirePermissions('activities:write')
  async callback(
    @Auth() auth: AuthContext,
    @Param('provider') rawProvider: string,
    @Query(new ZodPipe(callbackQuery)) q: z.infer<typeof callbackQuery>,
    @Meta() meta: RequestMeta,
    @Res() res: Response,
  ): Promise<void> {
    const back = `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app/integrations`;
    const provider = IntegrationsService.parseProvider(rawProvider);
    if (q.error || !q.code || !q.state) {
      res.redirect(302, `${back}?error=${encodeURIComponent(q.error ?? 'missing_code')}`);
      return;
    }
    try {
      await this.integrations.completeConnect(auth, provider, q.code, q.state, meta);
      res.redirect(302, `${back}?connected=${provider.toLowerCase()}`);
    } catch (err) {
      const code = (err as { response?: { code?: string } }).response?.code ?? 'connect_failed';
      res.redirect(302, `${back}?error=${encodeURIComponent(code.toLowerCase())}`);
    }
  }

  @Post(':provider/sync')
  @RequireFeature('email_sync')
  @HttpCode(200)
  @RequirePermissions('activities:write')
  sync(@Auth() auth: AuthContext, @Param('provider') provider: string) {
    return this.integrations.syncForUser(auth, IntegrationsService.parseProvider(provider));
  }

  @Delete(':provider')
  @HttpCode(204)
  @RequirePermissions('activities:write')
  disconnect(@Auth() auth: AuthContext, @Param('provider') provider: string, @Meta() meta: RequestMeta) {
    return this.integrations.disconnect(auth, IntegrationsService.parseProvider(provider), meta);
  }
}

@Controller()
export class CommunicationController {
  constructor(private readonly communication: CommunicationService) {}

  @Get('emails')
  @RequirePermissions('activities:read')
  emails(@Auth() auth: AuthContext, @Query(new ZodPipe(emailQuery)) q: z.infer<typeof emailQuery>) {
    return this.communication.listEmails(auth, q);
  }

  @Get('emails/:id')
  @RequirePermissions('activities:read')
  email(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.communication.getEmail(auth, id);
  }

  @Post('emails/send')
  @RequireFeature('email_sync')
  @RequirePermissions('activities:write')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(sendEmailSchema)) body: SendEmailInput, @Meta() meta: RequestMeta) {
    return this.communication.send(auth, body, meta);
  }

  @Get('meetings')
  @RequirePermissions('activities:read')
  meetings(@Auth() auth: AuthContext, @Query(new ZodPipe(meetingQuery)) q: z.infer<typeof meetingQuery>) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 60 * 86_400_000);
    return this.communication.listMeetings(auth, { from, to, contactId: q.contactId });
  }
}

/** Enhancement feature 8: conversations, assignment, categories, notes and mailbox sync logs. */
@Controller('inbox')
@RequireFeature('team_inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('threads')
  @RequirePermissions('activities:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(inboxQuerySchema)) q: InboxQuery) {
    return this.inbox.list(auth, q);
  }

  @Get('threads/:id')
  @RequirePermissions('activities:read')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.get(auth, id);
  }

  @Patch('threads/:id')
  @RequirePermissions('activities:write')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(inboxUpdateSchema)) body: InboxUpdate, @Meta() meta: RequestMeta) {
    return this.inbox.update(auth, id, body, meta);
  }

  @Post('threads/:id/notes')
  @RequirePermissions('activities:write')
  note(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(inboxNoteSchema)) body: { body: string }, @Meta() meta: RequestMeta) {
    return this.inbox.addNote(auth, id, body.body, meta);
  }

  @Get('sync-logs')
  @RequirePermissions('activities:read')
  syncLogs(@Auth() auth: AuthContext) {
    return this.inbox.syncLogs(auth);
  }
}
