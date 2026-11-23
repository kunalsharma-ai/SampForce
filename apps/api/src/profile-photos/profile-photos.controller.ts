import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Auth, type AuthContext, Meta, MobileAccess, type RequestMeta } from '../common/auth-context';
import { ProfilePhotosService, readPhotoUpload } from './profile-photos.service';

/** Profile photos (ADR 0072, M6), from the web and the phone. */
@MobileAccess()
@Controller()
export class ProfilePhotosController {
  constructor(private readonly photos: ProfilePhotosService) {}

  /** Sets the caller's photo: the image is the raw request body (PNG, JPEG or WebP, up to 1 MB). */
  @Put('me/photo')
  async set(@Auth() auth: AuthContext, @Req() req: Request, @Meta() meta: RequestMeta) {
    return this.photos.set(auth, await readPhotoUpload(req), meta);
  }

  @Delete('me/photo')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Meta() meta: RequestMeta) {
    await this.photos.remove(auth, meta);
  }

  /** The image. Its URL carries a version, so it may be kept; it can never run as a page. */
  @Get('people/:id/photo')
  async image(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const photo = await this.photos.image(auth, id);
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Content-Disposition', 'inline; filename="photo"');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.data);
  }
}
