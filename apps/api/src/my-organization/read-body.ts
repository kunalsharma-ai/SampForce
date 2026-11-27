import { PayloadTooLargeException } from '@nestjs/common';
import type { Request } from 'express';

/** Reads a raw request body (an uploaded file), refusing it as soon as it passes `max` bytes. */
export async function readBody(req: Request, max: number, message: string): Promise<Buffer> {
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message });
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw tooBig();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
