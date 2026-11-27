import { BadRequestException, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/auth-context';
import { NoPasswordConfirmation } from '../common/password-confirmation/password-confirmation.decorator';
import { PrismaService } from '../common/prisma.service';
import { sniffImage } from '../crm/company-logo-finder';
import { PHOTO_MAX_WIDTH, PHOTO_MIN_WIDTH, readPhotoUpload } from '../profile-photos/profile-photos.service';
import { Operator, OperatorAny, type OperatorContext, OperatorGuard } from './operator-auth';
import { writePlatformAudit } from './platform-audit';

const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Operators' photos in the Console (ADR 0087). An operator's own photo wins; without one, the Console uses the photo
 * of the SampForce account with the same email, so the photo a person chose on My profile shows in the Console too.
 */
@Injectable()
export class OperatorPhotosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Photo addresses for these operators, by operator id (only those that have a photo). */
  async urls(ops: { id: string; email: string }[]): Promise<Map<string, string>> {
    if (!ops.length) return new Map();
    const [own, users] = await Promise.all([
      this.prisma.operatorPhoto.findMany({ where: { operatorId: { in: ops.map((o) => o.id) } }, select: { operatorId: true, updatedAt: true } }),
      this.prisma.user.findMany({ where: { email: { in: ops.map((o) => o.email.toLowerCase()) } }, select: { email: true, photo: { select: { updatedAt: true } } } }),
    ]);
    const ownAt = new Map(own.map((p) => [p.operatorId, p.updatedAt]));
    const userAt = new Map(users.filter((u) => u.photo).map((u) => [u.email.toLowerCase(), u.photo!.updatedAt]));
    const out = new Map<string, string>();
    for (const o of ops) {
      const at = ownAt.get(o.id);
      const linked = userAt.get(o.email.toLowerCase());
      if (at) out.set(o.id, `/api/v1/operator/photos/${o.id}?v=o${at.getTime().toString(36)}`);
      else if (linked) out.set(o.id, `/api/v1/operator/photos/${o.id}?v=u${linked.getTime().toString(36)}`);
    }
    return out;
  }

  async urlFor(op: { id: string; email: string }): Promise<string | null> {
    return (await this.urls([op])).get(op.id) ?? null;
  }

  async set(op: OperatorContext, data: Buffer, ip: string | null): Promise<{ photoUrl: string }> {
    const img = data.length ? sniffImage(data) : null;
    if (!img || !PHOTO_TYPES.has(img.contentType)) throw new BadRequestException({ code: 'PHOTO_INVALID', message: 'Use a PNG, JPEG or WebP image.' });
    if (img.width === null || img.width < PHOTO_MIN_WIDTH || img.width > PHOTO_MAX_WIDTH) throw new BadRequestException({ code: 'PHOTO_INVALID', message: 'Use a photo between 64 and 4096 pixels wide.' });
    const bytes = new Uint8Array(data);
    await this.prisma.operatorPhoto.upsert({
      where: { operatorId: op.id },
      create: { operatorId: op.id, contentType: img.contentType, data: bytes, sizeBytes: data.length, width: img.width },
      update: { contentType: img.contentType, data: bytes, sizeBytes: data.length, width: img.width },
    });
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'operator.photo_set', target: { type: 'operator', id: op.id }, ip, metadata: { bytes: data.length } });
    return { photoUrl: (await this.urlFor(op))! };
  }

  async remove(op: OperatorContext, ip: string | null): Promise<void> {
    const { count } = await this.prisma.operatorPhoto.deleteMany({ where: { operatorId: op.id } });
    if (count) await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'operator.photo_removed', target: { type: 'operator', id: op.id }, ip, metadata: {} });
  }

  async image(operatorId: string): Promise<{ contentType: string; data: Buffer }> {
    const own = await this.prisma.operatorPhoto.findUnique({ where: { operatorId } });
    if (own) return { contentType: own.contentType, data: Buffer.from(own.data) };
    const op = await this.prisma.platformOperator.findUnique({ where: { id: operatorId }, select: { email: true } });
    const user = op ? await this.prisma.user.findUnique({ where: { email: op.email.toLowerCase() }, select: { photo: true } }) : null;
    if (!user?.photo) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This person has no photo.' });
    return { contentType: user.photo.contentType, data: Buffer.from(user.photo.data) };
  }
}

/** Console photo routes (ADR 0087). `@Public()` only skips the workspace guard; the operator guard applies. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class OperatorPhotosController {
  constructor(private readonly photos: OperatorPhotosService) {}

  /** Sets the signed-in operator's own photo: the image is the raw request body (PNG, JPEG or WebP, up to 1 MB). */
  @Put('me/photo')
  @OperatorAny()
  async set(@Operator() op: OperatorContext, @Req() req: Request) {
    return this.photos.set(op, await readPhotoUpload(req), req.ip ?? null);
  }

  @NoPasswordConfirmation('Your own Console photo; nothing else is lost')
  @Delete('me/photo')
  @OperatorAny()
  @HttpCode(204)
  async remove(@Operator() op: OperatorContext, @Req() req: Request) {
    await this.photos.remove(op, req.ip ?? null);
  }

  /** An operator's photo, for people signed in to the Console. The URL carries a version, so it may be kept. */
  @Get('photos/:id')
  @OperatorAny()
  async image(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const photo = await this.photos.image(id);
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Content-Disposition', 'inline; filename="photo"');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.data);
  }
}
