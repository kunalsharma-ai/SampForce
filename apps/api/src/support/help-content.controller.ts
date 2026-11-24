import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HELP_ARTICLE_KEY, helpArticleInputSchema, helpArticleListQuerySchema, helpCategoryInputSchema, helpFeedbackSchema, helpSettingsInputSchema, helpViewSchema, operatorHelpSettingsSchema } from '@dealflow/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auth, type AuthContext, MobileAccess, Public } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard, OperatorPermission, OperatorAny } from '../operator/operator-auth';
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { HelpContentService } from './help-content.service';

const uuid = new ParseUUIDPipe();
const categoryId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);
const feedbackQuerySchema = z.object({
  articleKey: z.string().regex(HELP_ARTICLE_KEY).optional(),
  helpful: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  open: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

/** What a workspace reader's Help Center adds to the built-in help, and "Was this helpful?" (ADR 0073). Phones use the same routes. */
@MobileAccess()
@Controller('help')
export class HelpContentController {
  constructor(private readonly content: HelpContentService) {}

  @Get('content')
  get(@Auth() auth: AuthContext) {
    return this.content.content(auth);
  }

  @Post('feedback')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  feedback(@Auth() auth: AuthContext, @Body(new ZodPipe(helpFeedbackSchema)) body: z.output<typeof helpFeedbackSchema>) {
    return this.content.feedback(auth, body);
  }

  @Post('views')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  view(@Auth() auth: AuthContext, @Body(new ZodPipe(helpViewSchema)) body: z.output<typeof helpViewSchema>) {
    return this.content.view(auth, body.articleKey);
  }

  /** The organisation's Help settings; raising and following queries works whatever they say. */
  @Get('settings')
  settings(@Auth() auth: AuthContext) {
    return this.content.settings(auth);
  }

  @Put('settings')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(helpSettingsInputSchema)) body: z.output<typeof helpSettingsInputSchema>, @Req() req: Request) {
    return this.content.saveSettings(auth, body, req.ip ?? null);
  }

  @Get('media/:id')
  async media(@Auth() _auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendMedia(res, await this.content.media(id));
  }
}

/**
 * The Console manages Help: articles and their versions, topics, pictures and files, and what readers said.
 * Any operator reads; only administrators write. `@Public()` only skips the workspace guard; OperatorGuard protects
 * every route.
 */
@Controller('operator/help')
@Public()
@UseGuards(OperatorGuard)
export class OperatorHelpController {
  constructor(private readonly content: HelpContentService) {}

  /** The Console's own Help page: published articles for the console audience. */
  @Get('content')
  @OperatorAny()
  consoleContent() {
    return this.content.consoleContent();
  }

  @Get('articles')
  @OperatorAny()
  list(@Query(new ZodPipe(helpArticleListQuerySchema)) q: z.output<typeof helpArticleListQuerySchema>) {
    return this.content.list(q);
  }

  @Get('articles/:id')
  @OperatorAny()
  get(@Param('id', uuid) id: string) {
    return this.content.get(id);
  }

  @Post('articles')
  @OperatorPermission('settings.manage')
  create(@Operator() op: OperatorContext, @Body(new ZodPipe(helpArticleInputSchema)) body: z.output<typeof helpArticleInputSchema>, @Req() req: Request) {
    return this.content.create(op, body, req.ip ?? null);
  }

  @Put('articles/:id')
  @OperatorPermission('settings.manage')
  update(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(helpArticleInputSchema)) body: z.output<typeof helpArticleInputSchema>, @Req() req: Request) {
    return this.content.update(op, id, body, req.ip ?? null);
  }

  @Post('articles/:id/publish')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  publish(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.content.setStatus(op, id, 'PUBLISHED', req.ip ?? null);
  }

  @Post('articles/:id/unpublish')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  unpublish(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.content.setStatus(op, id, 'DRAFT', req.ip ?? null);
  }

  @Post('articles/:id/archive')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  archive(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.content.setStatus(op, id, 'ARCHIVED', req.ip ?? null);
  }

  @Post('articles/:id/versions/:version/restore')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  restore(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Param('version', ParseIntPipe) version: number, @Req() req: Request) {
    return this.content.restore(op, id, version, req.ip ?? null);
  }

  @Get('categories')
  @OperatorAny()
  categories() {
    return this.content.categories();
  }

  @Put('categories')
  @OperatorPermission('settings.manage')
  saveCategory(@Operator() op: OperatorContext, @Body(new ZodPipe(helpCategoryInputSchema)) body: z.output<typeof helpCategoryInputSchema>, @Req() req: Request) {
    return this.content.saveCategory(op, body, req.ip ?? null);
  }

  @Post('categories/:id/archive')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  archiveCategory(@Operator() op: OperatorContext, @Param('id', new ZodPipe(categoryId)) id: string, @Req() req: Request) {
    return this.content.archiveCategory(op, id, true, req.ip ?? null);
  }

  @Post('categories/:id/restore')
  @OperatorPermission('settings.manage')
  @HttpCode(200)
  restoreCategory(@Operator() op: OperatorContext, @Param('id', new ZodPipe(categoryId)) id: string, @Req() req: Request) {
    return this.content.archiveCategory(op, id, false, req.ip ?? null);
  }

  @Get('media')
  @OperatorAny()
  mediaList() {
    return this.content.mediaList();
  }

  @Post('media')
  @OperatorPermission('settings.manage')
  async upload(@Operator() op: OperatorContext, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.content.upload(op, fileFrom(req, name, await readUpload(req)), req.ip ?? null);
  }

  @Get('media/:id')
  @OperatorAny()
  async media(@Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendMedia(res, await this.content.media(id));
  }

  /** Whether a client gets the Help Center's answers and guides. Support stays reachable either way. */
  @Get('clients/:tenantId/settings')
  @OperatorPermission('clients.view')
  clientSettings(@Param('tenantId', uuid) tenantId: string) {
    return this.content.clientSettings(tenantId);
  }

  @Put('clients/:tenantId/settings')
  @OperatorPermission('settings.manage')
  setClientSettings(@Operator() op: OperatorContext, @Param('tenantId', uuid) tenantId: string, @Body(new ZodPipe(operatorHelpSettingsSchema)) body: z.output<typeof operatorHelpSettingsSchema>, @Req() req: Request) {
    return this.content.setClientHelp(op, tenantId, body.helpEnabled, req.ip ?? null);
  }

  @Get('feedback')
  @OperatorPermission('support.handle')
  feedback(@Query(new ZodPipe(feedbackQuerySchema)) q: z.output<typeof feedbackQuerySchema>) {
    return this.content.feedbackList(q);
  }

  @Post('feedback/:id/review')
  @OperatorPermission('support.handle')
  @HttpCode(200)
  review(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Req() req: Request) {
    return this.content.reviewFeedback(op, id, req.ip ?? null);
  }
}

/** Pictures and videos show inside an article; other files download. Either way nothing in them can run. */
function sendMedia(res: Response, file: { name: string; contentType: string; data: Buffer }) {
  if (!/^(image|video)\//.test(file.contentType)) return sendFile(res, file);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', 'inline');
  // A file never changes once uploaded; an edit uploads a new one.
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.data);
}
