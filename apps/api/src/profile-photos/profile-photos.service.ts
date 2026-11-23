import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { sniffImage } from '../crm/company-logo-finder';
import { MobileConfigService } from '../mobile/mobile-config.service';

export const PHOTO_MAX_BYTES = 1_000_000;
export const PHOTO_MIN_WIDTH = 64;
export const PHOTO_MAX_WIDTH = 4096;
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** The versioned address of a person's photo, or null without one. */
export function photoUrl(userId: string, updatedAt: Date | null | undefined): string | null {
  return updatedAt ? `/api/v1/people/${userId}/photo?v=${updatedAt.getTime().toString(36)}` : null;
}

/** Reads a raw photo upload (the image is the request body), refusing anything over 1 MB as it streams in. */
export async function readPhotoUpload(req: Request): Promise<Buffer> {
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Photos can be up to 1 MB.' });
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > PHOTO_MAX_BYTES) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > PHOTO_MAX_BYTES) throw tooBig();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Profile photos (ADR 0072, M6). A person sets or removes their own photo from the web or the phone; people in the
 * same organisation can see it, unless the organisation's Mobile Configuration hides photos in the app.
 */
@Injectable()
export class ProfilePhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mobileConfigs: MobileConfigService,
  ) {}

  async urlFor(userId: string): Promise<string | null> {
    const row = await this.prisma.userPhoto.findUnique({ where: { userId }, select: { updatedAt: true } });
    return photoUrl(userId, row?.updatedAt);
  }

  async set(auth: AuthContext, data: Buffer, meta: RequestMeta): Promise<{ photoUrl: string }> {
    const img = data.length ? sniffImage(data) : null;
    if (!img || !PHOTO_TYPES.has(img.contentType)) throw new BadRequestException({ code: 'PHOTO_INVALID', message: 'Use a PNG, JPEG or WebP image.' });
    if (img.width === null || img.width < PHOTO_MIN_WIDTH || img.width > PHOTO_MAX_WIDTH) throw new BadRequestException({ code: 'PHOTO_INVALID', message: 'Use a photo between 64 and 4096 pixels wide.' });
    const bytes = new Uint8Array(data);
    const row = await this.prisma.userPhoto.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, contentType: img.contentType, data: bytes, sizeBytes: data.length, width: img.width },
      update: { contentType: img.contentType, data: bytes, sizeBytes: data.length, width: img.width },
      select: { updatedAt: true },
    });
    await this.prisma.run(auth, (tx) => this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'user.photo_set', entityType: 'user', entityId: auth.userId, metadata: { bytes: data.length, via: auth.via ?? 'web' }, meta }));
    return { photoUrl: photoUrl(auth.userId, row.updatedAt)! };
  }

  async remove(auth: AuthContext, meta: RequestMeta): Promise<void> {
    const { count } = await this.prisma.userPhoto.deleteMany({ where: { userId: auth.userId } });
    if (count) await this.prisma.run(auth, (tx) => this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'user.photo_removed', entityType: 'user', entityId: auth.userId, metadata: { via: auth.via ?? 'web' }, meta }));
  }

  /** A person's photo, for someone in the same organisation. Anyone else, or a missing photo, gets 404. */
  async image(auth: AuthContext, userId: string): Promise<{ contentType: string; data: Buffer }> {
    const missing = () => new NotFoundException({ code: 'NOT_FOUND', message: 'This person has no photo.' });
    if (userId !== auth.userId) {
      const visible = await this.prisma.run(auth, async (tx) => {
        const member = await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId, status: 'ACTIVE' }, select: { id: true } });
        if (!member) return false;
        // The organisation can hide photos in its app (Mobile Configuration); the phone then shows initials.
        if (auth.via === 'mobile') return (await this.mobileConfigs.resolvedFor(tx, auth)).profilePictures.visible;
        return true;
      });
      if (!visible) throw missing();
    }
    const row = await this.prisma.userPhoto.findUnique({ where: { userId } });
    if (!row) throw missing();
    return { contentType: row.contentType, data: Buffer.from(row.data) };
  }
}
