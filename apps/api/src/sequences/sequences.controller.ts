import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  type EmailAnalyticsQuery,
  emailAnalyticsQuerySchema,
  type EmailTemplateInput,
  type EmailVariableInput,
  emailVariableInputSchema,
  emailTemplateInputSchema,
  type EnrollInput,
  enrollInputSchema,
  type SequenceInput,
  sequenceInputSchema,
  sequenceStatusSchema,
  type SequenceTestSendInput,
  sequenceTestSendSchema,
  suppressionInputSchema,
  templatePreviewSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { EmailAnalyticsService } from './analytics.service';
import { SequenceRunner } from './sequence-runner.service';
import { SequencesService } from './sequences.service';
import { EmailVariablesService, TemplatesService } from './templates.service';

const uuid = new ParseUUIDPipe();
const enrollmentQuery = z.object({
  sequenceId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  status: z.enum(['live', 'finished']).optional(),
});
const enrollmentAction = z.object({ action: z.enum(['pause', 'resume', 'stop']) });
const removeSuppression = z.object({ reason: z.string().trim().max(500).optional() });
const templateListQuery = z.object({ category: z.string().trim().max(40).optional(), campaignId: z.string().uuid().optional() });

/** Workspace email variables: {{var.key}}. */
@Controller('email-variables')
@RequireFeature('email_templates')
export class EmailVariablesController {
  constructor(private readonly variables: EmailVariablesService) {}

  @Get()
  @RequirePermissions('sequences:read')
  list(@Auth() auth: AuthContext) {
    return this.variables.list(auth);
  }

  @Put()
  @RequirePermissions('marketing:manage')
  upsert(@Auth() auth: AuthContext, @Body(new ZodPipe(emailVariableInputSchema)) body: EmailVariableInput, @Meta() meta: RequestMeta) {
    return this.variables.upsert(auth, body, meta);
  }

  @Delete(':key')
  @HttpCode(204)
  @RequirePermissions('marketing:manage')
  remove(@Auth() auth: AuthContext, @Param('key') key: string, @Meta() meta: RequestMeta) {
    return this.variables.remove(auth, key, meta);
  }
}

@Controller('email-templates')
@RequireFeature('email_templates')
export class EmailTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('sequences:read')
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(templateListQuery)) q: z.infer<typeof templateListQuery>) {
    return this.templates.list(auth, q);
  }

  @Get('categories')
  @RequirePermissions('sequences:read')
  categories(@Auth() auth: AuthContext) {
    return this.templates.categories(auth);
  }

  @Get(':id')
  @RequirePermissions('sequences:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.templates.get(auth, id);
  }

  @Post(':id/duplicate')
  @RequirePermissions('sequences:write')
  duplicate(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.templates.duplicate(auth, id, meta);
  }

  @Post()
  @RequirePermissions('sequences:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(emailTemplateInputSchema)) body: EmailTemplateInput, @Meta() meta: RequestMeta) {
    return this.templates.create(auth, body, meta);
  }

  @Put(':id')
  @RequirePermissions('sequences:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(emailTemplateInputSchema)) body: EmailTemplateInput, @Meta() meta: RequestMeta) {
    return this.templates.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('sequences:write')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.templates.remove(auth, id, meta);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('sequences:read')
  preview(@Auth() auth: AuthContext, @Body(new ZodPipe(templatePreviewSchema)) body: z.infer<typeof templatePreviewSchema>) {
    return this.templates.preview(auth, body);
  }
}

@Controller('sequences')
@RequireFeature('sequences')
export class SequencesController {
  constructor(
    private readonly sequences: SequencesService,
    private readonly runner: SequenceRunner,
    private readonly analyticsService: EmailAnalyticsService,
  ) {}

  @Get()
  @RequirePermissions('sequences:read')
  list(@Auth() auth: AuthContext) {
    return this.sequences.list(auth);
  }

  @Get('enrollments')
  @RequirePermissions('sequences:read')
  enrollments(@Auth() auth: AuthContext, @Query(new ZodPipe(enrollmentQuery)) q: z.infer<typeof enrollmentQuery>) {
    return this.sequences.enrollments(auth, q);
  }

  @Post('enrollments/:id')
  @HttpCode(200)
  @RequirePermissions('sequences:write')
  changeEnrollment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(enrollmentAction)) body: z.infer<typeof enrollmentAction>, @Meta() meta: RequestMeta) {
    return this.sequences.changeEnrollment(auth, id, body.action, meta);
  }

  @Get('suppressions')
  @RequirePermissions('sequences:read')
  suppressions(@Auth() auth: AuthContext, @Query('search') search?: string) {
    return this.sequences.suppressions(auth, search?.slice(0, 200));
  }

  @Post('suppressions')
  @RequirePermissions('sequences:write')
  addSuppressions(@Auth() auth: AuthContext, @Body(new ZodPipe(suppressionInputSchema)) body: z.infer<typeof suppressionInputSchema>, @Meta() meta: RequestMeta) {
    return this.sequences.addSuppressions(auth, body.emails, meta);
  }

  @Post('suppressions/:email/remove')
  @HttpCode(204)
  @RequirePermissions('marketing:manage')
  removeSuppression(@Auth() auth: AuthContext, @Param('email') email: string, @Body(new ZodPipe(removeSuppression)) body: z.infer<typeof removeSuppression>, @Meta() meta: RequestMeta) {
    return this.sequences.removeSuppression(auth, email, body.reason, meta);
  }

  @Get('analytics')
  @RequirePermissions('sequences:read')
  analytics(@Auth() auth: AuthContext, @Query(new ZodPipe(emailAnalyticsQuerySchema)) q: EmailAnalyticsQuery) {
    return this.analyticsService.analytics(auth, q);
  }

  @Get(':id')
  @RequirePermissions('sequences:read')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.sequences.get(auth, id);
  }

  @Get(':id/step-stats')
  @RequirePermissions('sequences:read')
  stepStats(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.sequences.stepStats(auth, id);
  }

  @Post()
  @RequirePermissions('sequences:write')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(sequenceInputSchema)) body: SequenceInput, @Meta() meta: RequestMeta) {
    return this.sequences.create(auth, body, meta);
  }

  @Put(':id')
  @RequirePermissions('sequences:write')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(sequenceInputSchema)) body: SequenceInput, @Meta() meta: RequestMeta) {
    return this.sequences.update(auth, id, body, meta);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('sequences:write')
  setStatus(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(sequenceStatusSchema)) body: z.infer<typeof sequenceStatusSchema>, @Meta() meta: RequestMeta) {
    return this.sequences.setStatus(auth, id, body.status, meta);
  }

  /** Sends one email of the sequence to the caller's own mailbox address. */
  @Post(':id/test-send')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('sequences:write')
  testSend(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(sequenceTestSendSchema)) body: SequenceTestSendInput, @Meta() meta: RequestMeta) {
    return this.runner.testSend(auth, id, body, meta);
  }

  @Post(':id/enroll')
  @HttpCode(200)
  @RequirePermissions('sequences:write')
  enroll(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(enrollInputSchema)) body: EnrollInput, @Meta() meta: RequestMeta) {
    return this.sequences.enroll(auth, id, body, meta);
  }
}

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Public endpoints in sent emails: the open pixel, click redirects and unsubscribe. Every link carries a
 * signed token, so these need no session. Nothing about the recipient's network or device is stored.
 */
@Controller('t')
export class TrackingController {
  constructor(private readonly runner: SequenceRunner) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('o/:token')
  @Header('cache-control', 'no-store, private')
  async open(@Param('token') raw: string, @Res() res: Response): Promise<void> {
    const t = this.runner.signer.verify(raw.replace(/\.gif$/, ''));
    if (t) await this.runner.record(t.tenantId, t.messageId, 'OPENED').catch(() => false);
    res.type('image/gif').send(GIF);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('c/:token')
  async click(@Param('token') raw: string, @Query('u') url: string | undefined, @Query('s') sig: string | undefined, @Res() res: Response): Promise<void> {
    const t = this.runner.signer.verify(raw);
    const valid = !!t && !!url && !!sig && /^https?:\/\//i.test(url) && this.runner.signer.verifyUrl(raw, url, sig);
    if (!valid) {
      res.status(400).type('text/plain').send('This link is not valid.');
      return;
    }
    await this.runner.record(t.tenantId, t.messageId, 'CLICKED', url).catch(() => false);
    res.redirect(302, url);
  }

  /** What the unsubscribe page shows before the person confirms. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('u/:token')
  async unsubscribeInfo(@Param('token') raw: string) {
    const t = this.runner.signer.verify(raw);
    const info = t ? await this.runner.unsubscribeInfo(t.tenantId, t.messageId) : null;
    if (!info) return { valid: false };
    return { valid: true, email: info.email, workspace: info.workspace, unsubscribed: info.done };
  }

  /** The page's button and the RFC 8058 one-click List-Unsubscribe-Post both land here. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('u/:token')
  @HttpCode(200)
  async unsubscribe(@Param('token') raw: string) {
    const t = this.runner.signer.verify(raw);
    if (!t) return { valid: false };
    const info = await this.runner.unsubscribeInfo(t.tenantId, t.messageId);
    if (!info) return { valid: false };
    await this.runner.record(t.tenantId, t.messageId, 'UNSUBSCRIBED');
    return { valid: true, email: info.email, workspace: info.workspace, unsubscribed: true };
  }
}
