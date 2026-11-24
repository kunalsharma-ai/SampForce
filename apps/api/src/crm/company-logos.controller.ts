import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiKeyAccess, Auth, type AuthContext, Meta, type RequestMeta, RequirePermissions } from '../common/auth-context';
import { CompanyLogosService, readLogoUpload } from './company-logos.service';
import { ConfirmPassword } from '../common/password-confirmation';

const uuid = new ParseUUIDPipe();

/** A company's logo (ADR 0070): the image, an upload that replaces the automatic one, and a fresh look-up. */
@Controller('companies/:id/logo')
@ApiKeyAccess()
export class CompanyLogosController {
  constructor(private readonly logos: CompanyLogosService) {}

  /** The image. Its URL carries a version, so browsers may keep it; an SVG cannot run scripts (sandboxed). */
  @Get()
  @RequirePermissions('companies:read')
  async image(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    const logo = await this.logos.image(auth, id);
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Disposition', 'inline; filename="logo"');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(logo.data);
  }

  /** Uploads a logo: the image is the raw request body (PNG, JPEG, WebP, GIF, ICO or SVG, up to 1 MB). */
  @Put()
  @RequirePermissions('companies:write')
  async upload(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Req() req: Request, @Meta() meta: RequestMeta) {
    return this.logos.upload(auth, id, await readLogoUpload(req), meta);
  }

  /** Removes an uploaded logo; the automatic one from the website is looked up again. */
  @ConfirmPassword()
  @Delete()
  @HttpCode(200)
  @RequirePermissions('companies:write')
  async remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return { logo: await this.logos.remove(auth, id, meta) };
  }

  @Post('refresh')
  @HttpCode(200)
  @RequirePermissions('companies:write')
  refresh(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.logos.refresh(auth, id);
  }
}
