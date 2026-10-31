import { Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';
import { PORTAL_DOCUMENT_MAX_BYTES } from '@dealflow/types';
import { signToken, verifyToken } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';

const LINK_MINUTES = 10;

interface LinkClaims {
  t: string;
  d: string;
  c: string;
  exp: number;
}

/**
 * Short-lived signed links for downloading a portal document. The link names the workspace, the document and the
 * company it belongs to, so the download checks all three. Links expire after ten minutes and are only handed to a
 * signed-in customer of that company, or to a workspace member.
 */
@Injectable()
export class DocumentLinks {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  private get secret(): string {
    return `${this.env.JWT_ACCESS_SECRET}:portal-document`;
  }

  token(tenantId: string, documentId: string, companyId: string): string {
    return signToken(this.secret, { t: tenantId, d: documentId, c: companyId, exp: Date.now() + LINK_MINUTES * 60_000 } satisfies LinkClaims);
  }

  url(tenantId: string, documentId: string, companyId: string): string {
    return `/api/v1/client-portal/documents/download/${this.token(tenantId, documentId, companyId)}`;
  }

  verify(token: string): { tenantId: string; documentId: string; companyId: string } | null {
    const c = verifyToken<LinkClaims>(this.secret, token);
    if (!c || typeof c.exp !== 'number' || c.exp < Date.now() || !c.t || !c.d || !c.c) return null;
    return { tenantId: c.t, documentId: c.d, companyId: c.c };
  }
}

/** Reads an uploaded file sent as the raw request body, refusing anything over the portal's size limit. */
export async function readUpload(req: Request): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > PORTAL_DOCUMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > PORTAL_DOCUMENT_MAX_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Files can be up to 10 MB.' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
