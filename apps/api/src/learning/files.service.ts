import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  LEARNING_FILE_MAX_BYTES,
  LEARNING_MEDIA_MAX_BYTES,
  LEARNING_UPLOAD_PART_BYTES,
  type LearningFileRef,
  viewableContentType,
} from '@dealflow/types';
import { z } from 'zod';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { inScope, type LearningCaller, learningCaller, manageableModules, openModuleReaches } from './access';

/*
 * Learning files (ADR 0097): videos, audio, documents and answers people upload. A file is sent in parts of under a
 * megabyte (so a 500 MB video never sits in one request or one database document) and is only usable once every part
 * has arrived. Files are read back in ranges, so a video can be played from any point.
 */

export const fileCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the file a name').max(200),
    contentType: z.string().trim().max(120).optional(),
    sizeBytes: z.number().int().min(1, 'The file is empty').max(LEARNING_MEDIA_MAX_BYTES),
    /** An answer file for an attempt in progress (FILE_UPLOAD questions). */
    attemptId: z.string().uuid().optional(),
  })
  .strict();
export type FileCreateInput = z.infer<typeof fileCreateSchema>;

const TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.vtt': 'text/vtt',
  '.srt': 'application/x-subrip',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
};

/** The file's type: the browser's, unless it sent none or a generic one. */
export function contentTypeOf(name: string, declared?: string | null): string {
  const d = (declared ?? '').split(';')[0]!.trim().toLowerCase();
  if (d && d !== 'application/octet-stream' && /^[a-z]+\/[a-z0-9.+-]+$/.test(d)) return d;
  return TYPE_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

const isMedia = (type: string) => /^(video|audio)\//.test(type);
/** Shown inside the page. SVG is left out: it can carry script. */
export const inlineAllowed = (type: string) => viewableContentType(type) && type !== 'image/svg+xml';

export function fileRef(f: { id: string; name: string; contentType: string; sizeBytes: number }): LearningFileRef {
  return { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, viewable: inlineAllowed(f.contentType) };
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'File not found.' });

export interface FileRange {
  start: number;
  end: number;
}

@Injectable()
export class LearningFilesService {
  constructor(private readonly prisma: PrismaService) {}

  create(auth: AuthContext, input: FileCreateInput) {
    return this.prisma.run(auth, async (tx) => {
      const c = await learningCaller(tx, auth);
      const contentType = contentTypeOf(input.name, input.contentType);
      if (input.attemptId) {
        const attempt = await tx.learningAttempt.findFirst({ where: { id: input.attemptId, tenantId: auth.tenantId, userId: auth.userId, status: 'IN_PROGRESS' } });
        if (!attempt) throw new BadRequestException({ code: 'LEARNING_ATTEMPT_CLOSED', message: 'This attempt is no longer open for answers.' });
      } else if (!c.author) {
        throw new ForbiddenException({ code: 'LEARNING_AUTHOR_ONLY', message: 'Only the Super Workspace and managers can build learning modules.' });
      }
      const max = isMedia(contentType) ? LEARNING_MEDIA_MAX_BYTES : LEARNING_FILE_MAX_BYTES;
      if (input.sizeBytes > max) {
        throw new PayloadTooLargeException({ code: 'LEARNING_FILE_TOO_LARGE', message: isMedia(contentType) ? 'Videos and audio can be up to 500 MB.' : 'Documents and other files can be up to 50 MB.' });
      }
      const parts = Math.ceil(input.sizeBytes / LEARNING_UPLOAD_PART_BYTES);
      const file = await tx.learningFile.create({
        data: { tenantId: auth.tenantId, name: input.name, contentType, sizeBytes: input.sizeBytes, parts, uploadedById: auth.userId, attemptId: input.attemptId ?? null },
      });
      return { id: file.id, parts, partBytes: LEARNING_UPLOAD_PART_BYTES, contentType };
    });
  }

  putPart(auth: AuthContext, id: string, index: number, data: Buffer) {
    return this.prisma.run(auth, async (tx) => {
      const file = await tx.learningFile.findFirst({ where: { id, tenantId: auth.tenantId, uploadedById: auth.userId } });
      if (!file) throw notFound();
      if (file.completedAt) throw new BadRequestException({ code: 'LEARNING_FILE_COMPLETE', message: 'This file has already been uploaded.' });
      if (!Number.isInteger(index) || index < 0 || index >= file.parts) throw new BadRequestException({ code: 'LEARNING_FILE_PART', message: 'That part is not in this file.' });
      const last = index === file.parts - 1;
      const expected = last ? file.sizeBytes - LEARNING_UPLOAD_PART_BYTES * (file.parts - 1) : LEARNING_UPLOAD_PART_BYTES;
      if (data.length !== expected) throw new BadRequestException({ code: 'LEARNING_FILE_PART', message: 'That part is not the size it should be. Try the upload again.' });
      await tx.learningFilePart.upsert({
        where: { fileId_index: { fileId: id, index } },
        create: { tenantId: auth.tenantId, fileId: id, index, data: new Uint8Array(data) },
        update: { data: new Uint8Array(data) },
      });
      const received = await tx.learningFilePart.count({ where: { tenantId: auth.tenantId, fileId: id } });
      await tx.learningFile.update({ where: { id }, data: { received } });
      return { received, parts: file.parts };
    });
  }

  async complete(auth: AuthContext, id: string): Promise<LearningFileRef> {
    const file = await this.prisma.run(auth, (tx) => tx.learningFile.findFirst({ where: { id, tenantId: auth.tenantId, uploadedById: auth.userId } }));
    if (!file) throw notFound();
    if (file.completedAt) return fileRef(file);
    const hash = createHash('sha256');
    let size = 0;
    for (let from = 0; from < file.parts; from += 8) {
      const parts = await this.prisma.run(auth, (tx) =>
        tx.learningFilePart.findMany({ where: { tenantId: auth.tenantId, fileId: id, index: { gte: from, lt: from + 8 } }, orderBy: { index: 'asc' } }),
      );
      for (let i = 0; i < Math.min(8, file.parts - from); i++) {
        const p = parts[i];
        if (!p || p.index !== from + i) throw new BadRequestException({ code: 'LEARNING_FILE_INCOMPLETE', message: 'Some of the file has not arrived yet. Try the upload again.' });
        hash.update(p.data);
        size += p.data.length;
      }
    }
    if (size !== file.sizeBytes) throw new BadRequestException({ code: 'LEARNING_FILE_INCOMPLETE', message: 'Some of the file has not arrived yet. Try the upload again.' });
    const done = await this.prisma.run(auth, (tx) => tx.learningFile.update({ where: { id }, data: { completedAt: new Date(), sha256: hash.digest('hex'), received: file.parts } }));
    return fileRef(done);
  }

  /** The whole file (documents up to 50 MB), for reading its text. */
  async readWhole(tx: TenantTx, tenantId: string, id: string): Promise<Buffer> {
    const parts = await tx.learningFilePart.findMany({ where: { tenantId, fileId: id }, orderBy: { index: 'asc' } });
    return Buffer.concat(parts.map((p) => Buffer.from(p.data)));
  }

  /** Checks the caller may open the file, and says how. */
  async access(auth: AuthContext, id: string, download: boolean) {
    return this.prisma.run(auth, async (tx) => {
      const file = await tx.learningFile.findFirst({ where: { id, tenantId: auth.tenantId, completedAt: { not: null } } });
      if (!file) throw notFound();
      const c = await learningCaller(tx, auth);
      const ok = await this.mayOpen(tx, c, file, download);
      if (!ok) throw notFound();
      return { id: file.id, name: file.name, contentType: file.contentType, sizeBytes: file.sizeBytes, inline: !download && inlineAllowed(file.contentType) };
    });
  }

  private async mayOpen(tx: TenantTx, c: LearningCaller, file: { id: string; uploadedById: string; attemptId: string | null }, download: boolean): Promise<boolean> {
    if (file.uploadedById === c.auth.userId) return true;
    if (file.attemptId) {
      // An answer file: its author, and whoever may mark that person's work.
      const attempt = await tx.learningAttempt.findFirst({ where: { id: file.attemptId, tenantId: c.auth.tenantId } });
      if (!attempt || !c.manager) return false;
      const a = await tx.learningAssignment.findFirst({ where: { id: attempt.assignmentId } });
      const m = await tx.learningModule.findFirst({ where: { AND: [{ id: attempt.moduleId }, manageableModules(c)] } });
      return !!a && !!m && inScope(c, a.workspaceNodeId);
    }
    const lessons = await tx.learningLesson.findMany({ where: { tenantId: c.auth.tenantId, OR: [{ fileId: file.id }, { captionsFileId: file.id }] }, take: 50 });
    for (const lesson of lessons) {
      const m = await tx.learningModule.findFirst({ where: { id: lesson.moduleId, tenantId: c.auth.tenantId } });
      if (!m) continue;
      if (c.author || c.manager) {
        const managed = await tx.learningModule.findFirst({ where: { AND: [{ id: m.id }, manageableModules(c)] }, select: { id: true } });
        if (managed) return true;
      }
      if (m.status !== 'PUBLISHED' && m.status !== 'ARCHIVED') continue;
      if (download && !lesson.allowDownload) continue;
      const assigned = await tx.learningAssignment.findFirst({ where: { moduleId: m.id, userId: c.auth.userId, removedAt: null }, select: { id: true } });
      if (assigned) return true;
      if (m.status === 'PUBLISHED' && m.visibility === 'OPEN' && openModuleReaches(c.org, m.ownerNodeId, c.nodeId)) return true;
    }
    return false;
  }

  /** Reads a byte range in parts, a few at a time, writing each piece as it comes. */
  async stream(auth: AuthContext, id: string, range: FileRange, write: (chunk: Buffer) => Promise<void>): Promise<void> {
    const P = LEARNING_UPLOAD_PART_BYTES;
    const first = Math.floor(range.start / P);
    const last = Math.floor(range.end / P);
    for (let from = first; from <= last; from += 4) {
      const to = Math.min(last, from + 3);
      const parts = await this.prisma.run(auth, (tx) => tx.learningFilePart.findMany({ where: { tenantId: auth.tenantId, fileId: id, index: { gte: from, lte: to } }, orderBy: { index: 'asc' } }));
      for (const p of parts) {
        const base = p.index * P;
        const data = Buffer.from(p.data);
        const s = Math.max(0, range.start - base);
        const e = Math.min(data.length, range.end - base + 1);
        if (e > s) await write(data.subarray(s, e));
      }
    }
  }
}

/** Reads a Range header ("bytes=0-1023"); null for none or one that cannot be served. */
export function parseRange(header: string | undefined, size: number): FileRange | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'invalid';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}
