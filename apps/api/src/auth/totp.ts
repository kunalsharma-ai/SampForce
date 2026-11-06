import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30-second steps), as authenticator apps implement them. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (the size RFC 4226 recommends), base32-encoded. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / STEP_SECONDS);
}

/** HOTP value (RFC 4226) for a counter. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, '0');
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the matched
 * step, or null. Steps at or before `lastStep` are refused so an observed code cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; lastStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = stepAt(opts.now ?? Date.now() / 1000);
  const given = Buffer.from(code);
  for (const step of [current - 1, current, current + 1]) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), given)) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = 'SampForce'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten one-time recovery codes like `k7m2p-9xq4t` (50 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Recovery codes are compared without the dash and case-insensitively. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}
