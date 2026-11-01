import { inflateRawSync } from 'node:zlib';

/** Limits for a spreadsheet's unpacked size, so a small file cannot expand into gigabytes (a "zip bomb"). */
export const XLSX_MAX_UNPACKED_BYTES = 60 * 1024 * 1024;
export const XLSX_MAX_ENTRIES = 2000;

export class UnsafeZipError extends Error {}

/**
 * Walks the ZIP central directory and inflates every entry with a running output budget before the file is handed
 * to the spreadsheet reader. It checks the real inflated size, not only the sizes the file declares. ZIP64,
 * encryption and compression methods other than stored and deflate are refused; .xlsx files do not need them.
 */
export function assertSafeZip(buf: Buffer, maxUnpacked = XLSX_MAX_UNPACKED_BYTES, maxEntries = XLSX_MAX_ENTRIES): void {
  const bad = (why: string) => new UnsafeZipError(why);
  // End of central directory: 22 bytes plus a comment of up to 65,535 bytes, at the end of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('not a ZIP file');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw bad('ZIP64 is not supported');
  if (entries > maxEntries) throw bad('too many entries');
  let p = cdOffset;
  let budget = maxUnpacked;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad('damaged central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const declared = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (flags & 0x1) throw bad('encrypted entries are not supported');
    if (compressed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) throw bad('ZIP64 is not supported');
    if (declared > budget) throw bad('unpacks too large');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad('damaged entry');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (data.length !== compressed) throw bad('damaged entry');
    let size: number;
    if (method === 0) size = compressed;
    else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch (e) {
        throw bad(e instanceof RangeError ? 'unpacks too large' : 'damaged entry');
      }
    } else throw bad('unsupported compression');
    budget -= size;
    if (budget < 0) throw bad('unpacks too large');
    p += 46 + nameLen + extraLen + commentLen;
  }
}
