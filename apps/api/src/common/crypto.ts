import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from './env';

/**
 * Symmetric encryption for secrets at rest (webhook signing secrets, mailbox OAuth tokens):
 * AES-256-GCM with a random 96-bit nonce. Output: `v1.<nonce>.<tag>.<ciphertext>` (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(env: Pick<ApiEnv, 'ENCRYPTION_KEY' | 'JWT_ACCESS_SECRET'>) {
    if (env.ENCRYPTION_KEY) {
      const raw = /^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY)
        ? Buffer.from(env.ENCRYPTION_KEY, 'hex')
        : Buffer.from(env.ENCRYPTION_KEY, 'base64');
      // Accept any sufficiently long key material and normalise it to 32 bytes.
      this.key = raw.length === 32 ? raw : Buffer.from(hkdfSync('sha256', raw, '', 'dealflow-secretbox', 32));
    } else {
      // Development and test only (production refuses to start without ENCRYPTION_KEY).
      this.key = Buffer.from(hkdfSync('sha256', env.JWT_ACCESS_SECRET, '', 'dealflow-secretbox-dev', 32));
    }
  }

  seal(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [v, nonce, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !nonce || !tag || ct === undefined) throw new Error('Unrecognised secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}

export const SECRET_BOX = Symbol('SECRET_BOX');

/** Signs a payload for transport (OAuth state). Returns `<payload>.<sig>` in base64url. */
export function signToken(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T>(secret: string, token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
