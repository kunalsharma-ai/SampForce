import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  type PortalBranding,
  type PortalDashboard,
  type PortalDocumentRow,
  type PortalMe,
  type PortalMessageRow,
  type PortalRequest,
  type PortalRequestRow,
  type PortalSettings,
  type PortalSettingsInput,
  type PortalUserRow,
  portalAcceptSchema,
  portalDecisionSchema,
  portalForgotSchema,
  portalInviteSchema,
  portalLoginSchema,
  portalMessageSchema,
  portalRequestCreateSchema,
  portalRequestUpdateSchema,
  portalResetSchema,
  portalSettingsSchema,
  portalUserUpdateSchema,
  PORTAL_SLUG_PATTERN,
  type PublicProposal,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions, RequireFeature } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { type CompanyPortal, PortalAdminService } from './portal-admin.service';
import { PORTAL_COOKIE, PORTAL_COOKIE_PATH, PortalAuthService, type PortalContext } from './portal-auth.service';
import { contentDisposition, DocumentLinks, readUpload } from './portal-documents';
import { PortalService } from './portal.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const authLimit = { default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };
const visibilitySchema = z.object({ visible: z.boolean() });

function slugOf(raw: string): string {
  const slug = String(raw).toLowerCase();
  if (!PORTAL_SLUG_PATTERN.test(slug)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This portal does not exist or is switched off.' });
  return slug;
}

function fileFrom(req: Request, name: string | undefined, data: Buffer) {
  if (!name) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a name.' });
  return { name: String(name).trim(), contentType: String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase(), data };
}

function sendFile(res: Response, file: { name: string; contentType: string; data: Buffer }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.name));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(file.data);
}

// ─────────────── Customers ───────────────

/**
 * Routes used by signed-in customers. They are public as far as workspace sign-in goes; each one resolves the
 * portal session cookie itself, so a workspace member's session never reaches portal data this way and a portal
 * session never reaches the CRM.
 */
@Controller('client-portal')
export class ClientPortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
    private readonly links: DocumentLinks,
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private ctx(req: Request): Promise<PortalContext> {
    return this.auth.session((req.cookies as Record<string, string> | undefined)?.[PORTAL_COOKIE]);
  }

  private setCookie(res: Response, token: string) {
    res.cookie(PORTAL_COOKIE, token, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: PORTAL_COOKIE_PATH, maxAge: 7 * 86_400_000 });
  }

  @Public()
  @Get('portals/:slug')
  info(@Param('slug') slug: string): Promise<PortalBranding> {
    return this.auth.branding(slugOf(slug));
  }

  @Public()
  @Throttle(authLimit)
  @Post('portals/:slug/login')
  @HttpCode(204)
  async login(@Param('slug') slug: string, @Body(new ZodPipe(portalLoginSchema)) body: { email: string; password: string }, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<void> {
    const { token } = await this.auth.login(slugOf(slug), body.email, body.password, meta);
    this.setCookie(res, token);
  }

  @Public()
  @Throttle(authLimit)
  @Post('portals/:slug/password/forgot')
  @HttpCode(202)
  async forgot(@Param('slug') slug: string, @Body(new ZodPipe(portalForgotSchema)) body: { email: string }, @Meta() meta: RequestMeta): Promise<{ ok: true }> {
    await this.auth.forgot(slugOf(slug), body.email, meta);
    return { ok: true };
  }

  @Public()
  @Throttle(authLimit)
  @Post('invitations/accept')
  async accept(@Body(new ZodPipe(portalAcceptSchema)) body: { token: string; password: string }, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response): Promise<{ slug: string }> {
    const { token, slug } = await this.auth.acceptInvite(body.token, body.password, meta);
    this.setCookie(res, token);
    return { slug };
  }

  @Public()
  @Throttle(authLimit)
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(portalResetSchema)) body: { token: string; password: string }, @Meta() meta: RequestMeta): Promise<void> {
    await this.auth.reset(body.token, body.password, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[PORTAL_COOKIE]);
    res.clearCookie(PORTAL_COOKIE, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: PORTAL_COOKIE_PATH });
  }

  @Public()
  @Get('me')
  async me(@Req() req: Request): Promise<PortalMe> {
    return this.portal.me(await this.ctx(req));
  }

  @Public()
  @Get('dashboard')
  async dashboard(@Req() req: Request): Promise<PortalDashboard> {
    return this.portal.dashboard(await this.ctx(req));
  }

  @Public()
  @Post('updates/seen')
  @HttpCode(204)
  async seen(@Req() req: Request): Promise<void> {
    await this.portal.markUpdatesSeen(await this.ctx(req));
  }

  @Public()
  @Get('proposals/:id')
  async proposal(@Req() req: Request, @Param('id', uuid) id: string): Promise<PublicProposal> {
    return this.portal.proposal(await this.ctx(req), id);
  }

  @Public()
  @Post('proposals/:id/decision')
  async decide(@Req() req: Request, @Param('id', uuid) id: string, @Body(new ZodPipe(portalDecisionSchema)) body: { decision: 'accept' | 'decline'; note?: string }, @Meta() meta: RequestMeta): Promise<{ status: string }> {
    return this.portal.decide(await this.ctx(req), id, body.decision, body.note, meta);
  }

  @Public()
  @Get('requests')
  async requests(@Req() req: Request): Promise<PortalRequestRow[]> {
    return this.portal.listRequests(await this.ctx(req));
  }

  @Public()
  @Post('requests')
  async createRequest(@Req() req: Request, @Body(new ZodPipe(portalRequestCreateSchema)) body: { subject: string; category: string; body: string }, @Meta() meta: RequestMeta): Promise<PortalRequest> {
    return this.portal.createRequest(await this.ctx(req), body, meta);
  }

  @Public()
  @Get('requests/:id')
  async request(@Req() req: Request, @Param('id', uuid) id: string): Promise<PortalRequest> {
    return this.portal.getRequest(await this.ctx(req), id);
  }

  @Public()
  @Post('requests/:id/messages')
  async replyToRequest(@Req() req: Request, @Param('id', uuid) id: string, @Body(new ZodPipe(portalMessageSchema)) body: { body: string }): Promise<PortalRequest> {
    return this.portal.replyToRequest(await this.ctx(req), id, body.body);
  }

  @Public()
  @Get('messages')
  async messages(@Req() req: Request): Promise<PortalMessageRow[]> {
    return this.portal.messages(await this.ctx(req));
  }

  @Public()
  @Post('messages')
  async sendMessage(@Req() req: Request, @Body(new ZodPipe(portalMessageSchema)) body: { body: string }): Promise<PortalMessageRow[]> {
    return this.portal.sendMessage(await this.ctx(req), body.body);
  }

  @Public()
  @Get('documents')
  async documents(@Req() req: Request): Promise<(PortalDocumentRow & { downloadUrl: string })[]> {
    return this.portal.documents(await this.ctx(req));
  }

  @Public()
  @Post('documents')
  async upload(@Req() req: Request, @Query('name') name: string | undefined, @Meta() meta: RequestMeta): Promise<PortalDocumentRow> {
    const ctx = await this.ctx(req);
    return this.portal.upload(ctx, fileFrom(req, name, await readUpload(req)), meta);
  }

  /** Downloads go through a ten-minute signed link, so they also work from a plain link for workspace members. */
  @Public()
  @Get('documents/download/:token')
  async download(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const claims = this.links.verify(token);
    if (!claims) throw new NotFoundException({ code: 'LINK_EXPIRED', message: 'This download link has expired. Open the document again from the portal.' });
    const doc = await this.prisma.run({ tenantId: claims.tenantId }, (tx) =>
      tx.portalDocument.findFirst({ where: { id: claims.documentId, tenantId: claims.tenantId, companyId: claims.companyId }, select: { name: true, contentType: true, data: true } }),
    );
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found.' });
    sendFile(res, { name: doc.name, contentType: doc.contentType, data: Buffer.from(doc.data) });
  }
}

// ─────────────── Workspace members ───────────────

@Controller('portal')
@RequireFeature('client_portal')
export class PortalAdminController {
  constructor(private readonly admin: PortalAdminService) {}

  @Get('settings')
  @RequirePermissions('companies:read')
  settings(@Auth() auth: AuthContext): Promise<PortalSettings> {
    return this.admin.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('tenant:manage')
  saveSettings(@Auth() auth: AuthContext, @Body(new ZodPipe(portalSettingsSchema)) body: PortalSettingsInput, @Meta() meta: RequestMeta): Promise<PortalSettings> {
    return this.admin.saveSettings(auth, body, meta);
  }

  @Get('users')
  @RequirePermissions('companies:read')
  users(@Auth() auth: AuthContext, @Query('companyId') companyId: string | undefined): Promise<PortalUserRow[]> {
    return this.admin.users(auth, companyId && /^[0-9a-f-]{36}$/i.test(companyId) ? companyId : undefined);
  }

  @Post('users')
  @RequirePermissions('companies:write')
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(portalInviteSchema)) body: { companyId: string; contactId?: string; email: string; name: string; role: string }, @Meta() meta: RequestMeta) {
    return this.admin.invite(auth, body, meta);
  }

  @Patch('users/:id')
  @RequirePermissions('companies:write')
  updateUser(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(portalUserUpdateSchema)) body: { role?: string; status?: 'active' | 'disabled' }, @Meta() meta: RequestMeta): Promise<PortalUserRow> {
    return this.admin.updateUser(auth, id, body, meta);
  }

  @Post('users/:id/invitation')
  @RequirePermissions('companies:write')
  resend(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.admin.resendInvite(auth, id, meta);
  }

  @Delete('users/:id')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  removeUser(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta): Promise<void> {
    return this.admin.removeUser(auth, id, meta);
  }

  @Get('companies/:id')
  @RequirePermissions('companies:read')
  company(@Auth() auth: AuthContext, @Param('id', uuid) id: string): Promise<CompanyPortal> {
    return this.admin.company(auth, id);
  }

  @Post('companies/:id/messages')
  @RequirePermissions('companies:write')
  message(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(portalMessageSchema)) body: { body: string }): Promise<PortalMessageRow[]> {
    return this.admin.sendMessage(auth, id, body.body);
  }

  @Post('companies/:id/documents')
  @RequirePermissions('companies:write')
  async upload(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Req() req: Request, @Meta() meta: RequestMeta): Promise<PortalDocumentRow> {
    return this.admin.upload(auth, id, fileFrom(req, name, await readUpload(req)), meta);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermissions('companies:write')
  removeDocument(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta): Promise<void> {
    return this.admin.removeDocument(auth, id, meta);
  }

  @Get('documents/:id/download')
  @RequirePermissions('companies:read')
  async download(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.admin.download(auth, id));
  }

  @Put('tasks/:id/visibility')
  @RequirePermissions('activities:write')
  visibility(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(visibilitySchema)) body: { visible: boolean }, @Meta() meta: RequestMeta) {
    return this.admin.setTaskVisibility(auth, id, body.visible, meta);
  }

  @Get('requests')
  @RequirePermissions('companies:read')
  requests(@Auth() auth: AuthContext, @Query('status') status: string | undefined, @Query('mine') mine: string | undefined): Promise<PortalRequestRow[]> {
    const ok = ['active', 'open', 'in_progress', 'resolved', 'closed'];
    return this.admin.requests(auth, { status: status && ok.includes(status) ? status : undefined, mine: mine === 'true' });
  }

  @Get('requests/:id')
  @RequirePermissions('companies:read')
  request(@Auth() auth: AuthContext, @Param('id', uuid) id: string): Promise<PortalRequest> {
    return this.admin.request(auth, id);
  }

  @Patch('requests/:id')
  @RequirePermissions('companies:write')
  updateRequest(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(portalRequestUpdateSchema)) body: { status?: string; assignedToId?: string | null }, @Meta() meta: RequestMeta): Promise<PortalRequest> {
    return this.admin.updateRequest(auth, id, body, meta);
  }

  @Post('requests/:id/messages')
  @RequirePermissions('companies:write')
  reply(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(portalMessageSchema)) body: { body: string }): Promise<PortalRequest> {
    return this.admin.reply(auth, id, body.body);
  }
}
