import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ORG_LOGO_MAX_BYTES,
  type OrgCredentialInput,
  orgCredentialInputSchema,
  type OrgCredentialUpdate,
  orgCredentialUpdateSchema,
  orgDocumentMetaSchema,
  type OrgDocumentQuery,
  orgDocumentQuerySchema,
  type OrgDocumentUpdate,
  orgDocumentUpdateSchema,
  type OrgProfileInput,
  orgProfileInputSchema,
  orgShareInputSchema,
  ORG_DOCUMENT_MAX_BYTES,
  type z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { ConfirmPassword } from '../common/password-confirmation';
import { ZodPipe } from '../common/zod.pipe';
import { contentDisposition } from '../portal/portal-documents';
import { MyOrganizationService } from './my-organization.service';
import { OrgSharesService } from './org-shares.service';
import { readBody } from './read-body';

const uuid = new ParseUUIDPipe();

function sendDocument(res: Response, file: { name: string; contentType: string; data: Buffer }, inline: boolean) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', inline ? contentDisposition(file.name).replace(/^attachment/, 'inline') : contentDisposition(file.name));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Nothing in the file can run, and only SampForce's own pages may show it in a frame (the preview).
  const pdfPreview = inline && file.contentType === 'application/pdf';
  // Chrome's PDF viewer does not start under a sandbox or `default-src 'none'`, so an inline PDF only limits who may
  // frame it. PDFs run no page script here; every other file keeps the locked-down policy.
  res.setHeader('Content-Security-Policy', pdfPreview ? "frame-ancestors 'self'" : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; sandbox");
  res.send(file.data);
}

function sendLogo(res: Response, logo: { contentType: string; data: Buffer }) {
  res.setHeader('Content-Type', logo.contentType);
  res.setHeader('Content-Disposition', 'inline; filename="logo"');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(logo.data);
}

const fileName = (name: unknown) => {
  if (typeof name !== 'string' || !name.trim()) throw new BadRequestException({ code: 'INVALID_NAME', message: 'Give the file a name.' });
  return name;
};

/**
 * My Organization (ADR 0100). Every route is open to everyone signed in to the organisation (tenant:read, which every
 * role has); what each person may change is decided in the service from their workspace (org-access.ts), so the
 * same record serves the Super, Manager and Executive Workspaces.
 */
@Controller('organization')
export class MyOrganizationController {
  constructor(
    private readonly org: MyOrganizationService,
    private readonly shares: OrgSharesService,
  ) {}

  @Get()
  @RequirePermissions('tenant:read')
  overview(@Auth() auth: AuthContext) {
    return this.org.overview(auth);
  }

  @Put('profile')
  @RequirePermissions('tenant:read')
  save(@Auth() auth: AuthContext, @Body(new ZodPipe(orgProfileInputSchema)) body: OrgProfileInput, @Meta() meta: RequestMeta) {
    return this.org.saveProfile(auth, body, meta);
  }

  @Get('logo')
  @RequirePermissions('tenant:read')
  async logo(@Auth() auth: AuthContext, @Res() res: Response): Promise<void> {
    sendLogo(res, await this.org.logo(auth));
  }

  /** The logo is the raw request body: PNG, JPEG, WebP or SVG, up to 2 MB. */
  @Put('logo')
  @RequirePermissions('tenant:read')
  async uploadLogo(@Auth() auth: AuthContext, @Req() req: Request, @Meta() meta: RequestMeta) {
    return this.org.uploadLogo(auth, await readBody(req, ORG_LOGO_MAX_BYTES, 'Logos can be up to 2 MB.'), meta);
  }

  @ConfirmPassword()
  @Delete('logo')
  @HttpCode(200)
  @RequirePermissions('tenant:read')
  removeLogo(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    return this.org.removeLogo(auth, meta);
  }

  // ─── Documents ───

  @Get('documents')
  @RequirePermissions('tenant:read')
  documents(@Auth() auth: AuthContext, @Query(new ZodPipe(orgDocumentQuerySchema)) q: OrgDocumentQuery) {
    return this.org.listDocuments(auth, q);
  }

  /**
   * Uploads a document: the file is the raw request body, its name is `name`, and its details are the JSON in `meta`
   * (title, category, dates, who sees it, whether clients may get it).
   */
  @Post('documents')
  @RequirePermissions('tenant:read')
  async upload(@Auth() auth: AuthContext, @Query('name') name: unknown, @Query('meta') rawMeta: unknown, @Req() req: Request, @Meta() meta: RequestMeta) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof rawMeta === 'string' ? rawMeta : '');
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: 'meta', message: 'Send the document details as JSON' }] });
    }
    const details = new ZodPipe(orgDocumentMetaSchema).transform(parsed) as z.output<typeof orgDocumentMetaSchema>;
    const data = await readBody(req, ORG_DOCUMENT_MAX_BYTES, 'Documents can be up to 15 MB.');
    return this.org.uploadDocument(auth, details, { name: fileName(name), contentType: contentTypeOf(req), data }, meta);
  }

  @Get('documents/:id')
  @RequirePermissions('tenant:read')
  document(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.org.document(auth, id);
  }

  @Patch('documents/:id')
  @RequirePermissions('tenant:read')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(orgDocumentUpdateSchema)) body: OrgDocumentUpdate, @Meta() meta: RequestMeta) {
    return this.org.updateDocument(auth, id, body, meta);
  }

  /** A new version of the document: the raw body, named `name`, with an optional `note` on what changed. */
  @Post('documents/:id/versions')
  @RequirePermissions('tenant:read')
  async replace(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('name') name: unknown, @Query('note') note: unknown, @Req() req: Request, @Meta() meta: RequestMeta) {
    const data = await readBody(req, ORG_DOCUMENT_MAX_BYTES, 'Documents can be up to 15 MB.');
    const n = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
    return this.org.replaceDocument(auth, id, { name: fileName(name), contentType: contentTypeOf(req), data }, n, meta);
  }

  /** The current file, or `version`; `inline=1` lets the browser show it instead of saving it. */
  @Get('documents/:id/file')
  @RequirePermissions('tenant:read')
  async file(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('version') version: unknown, @Query('inline') inline: unknown, @Res() res: Response, @Meta() meta: RequestMeta): Promise<void> {
    const v = typeof version === 'string' && /^\d{1,5}$/.test(version) ? Number(version) : null;
    sendDocument(res, await this.org.download(auth, id, v, meta), inline === '1');
  }

  @ConfirmPassword()
  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermissions('tenant:read')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.org.removeDocument(auth, id, meta);
  }

  // ─── Credentials ───

  @Get('credentials')
  @RequirePermissions('tenant:read')
  credentials(@Auth() auth: AuthContext) {
    return this.org.listCredentials(auth);
  }

  @Post('credentials')
  @RequirePermissions('tenant:read')
  addCredential(@Auth() auth: AuthContext, @Body(new ZodPipe(orgCredentialInputSchema)) body: OrgCredentialInput, @Meta() meta: RequestMeta) {
    return this.org.addCredential(auth, body, meta);
  }

  @Patch('credentials/:id')
  @RequirePermissions('tenant:read')
  updateCredential(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(orgCredentialUpdateSchema)) body: OrgCredentialUpdate, @Meta() meta: RequestMeta) {
    return this.org.updateCredential(auth, id, body, meta);
  }

  /** Shows the sealed secret after the person confirms their password; the reveal is kept in the history. */
  @ConfirmPassword({ deletes: false })
  @Post('credentials/:id/reveal')
  @HttpCode(200)
  @RequirePermissions('tenant:read')
  reveal(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.org.reveal(auth, id, meta);
  }

  @ConfirmPassword()
  @Delete('credentials/:id')
  @HttpCode(204)
  @RequirePermissions('tenant:read')
  removeCredential(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.org.removeCredential(auth, id, meta);
  }

  // ─── Sharing and history ───

  @Get('shares')
  @RequirePermissions('tenant:read')
  listShares(@Auth() auth: AuthContext) {
    return this.shares.list(auth);
  }

  @Post('shares')
  @RequirePermissions('tenant:read')
  share(@Auth() auth: AuthContext, @Body(new ZodPipe(orgShareInputSchema)) body: z.output<typeof orgShareInputSchema>, @Meta() meta: RequestMeta) {
    return this.shares.create(auth, body, meta);
  }

  @Post('shares/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('tenant:read')
  revoke(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.shares.revoke(auth, id, meta);
  }

  @Get('activity')
  @RequirePermissions('tenant:read')
  activity(@Auth() auth: AuthContext, @Query('limit') limit: unknown) {
    const n = typeof limit === 'string' && /^\d{1,3}$/.test(limit) ? Number(limit) : 50;
    return this.org.activity(auth, n);
  }
}

/** What a client opens from a share link: no sign-in, only what the link names and only while it is live. */
@Controller('organization-shares')
export class OrgSharedController {
  constructor(private readonly shares: OrgSharesService) {}

  @Public()
  @Get(':token')
  view(@Param('token') token: string) {
    return this.shares.view(token);
  }

  @Public()
  @Get(':token/logo')
  async logo(@Param('token') token: string, @Res() res: Response): Promise<void> {
    sendLogo(res, await this.shares.logo(token));
  }

  @Public()
  @Get(':token/documents/:documentId')
  async file(@Param('token') token: string, @Param('documentId', uuid) documentId: string, @Query('inline') inline: unknown, @Res() res: Response): Promise<void> {
    sendDocument(res, await this.shares.file(token, documentId), inline === '1');
  }
}

function contentTypeOf(req: Request): string {
  return String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
}
