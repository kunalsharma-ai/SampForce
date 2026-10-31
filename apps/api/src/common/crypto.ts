import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from './env';

function deriveKey(material: string): Buffer {
  const raw = /^[0-9a-f]{64}$/i.test(material) ? Buffer.from(material, 'hex') : Buffer.from(material, 'base64');
  // Accept any sufficiently long key material and normalise it to 32 bytes.
  return raw.length === 32 ? raw : Buffer.from(hkdfSync('sha256', raw, '', 'dealflow-secretbox', 32));
}

/**
 * Symmetric encryption for secrets at rest (webhook signing secrets, mailbox OAuth tokens, TOTP secrets,
 * SSO client secrets): AES-256-GCM with a random 96-bit nonce. Output: `v1.<nonce>.<tag>.<ciphertext>` (base64url).
 *
 * Key rotation: set the new key as ENCRYPTION_KEY and the old one as ENCRYPTION_KEY_PREVIOUS. Values sealed
 * with either key open; new values use the new key. `scripts/reseal-secrets.ts` then re-seals stored values,
 * after which ENCRYPTION_KEY_PREVIOUS can be removed (docs/runbooks/key-rotation.md).
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly previous: Buffer | null;

  constructor(env: Pick<ApiEnv, 'ENCRYPTION_KEY' | 'JWT_ACCESS_SECRET'> & { ENCRYPTION_KEY_PREVIOUS?: string }) {
    if (env.ENCRYPTION_KEY) {
      this.key = deriveKey(env.ENCRYPTION_KEY);
    } else {
      // Development and test only (production refuses to start without ENCRYPTION_KEY).
      this.key = Buffer.from(hkdfSync('sha256', env.JWT_ACCESS_SECRET, '', 'dealflow-secretbox-dev', 32));
    }
    this.previous = env.ENCRYPTION_KEY_PREVIOUS ? deriveKey(env.ENCRYPTION_KEY_PREVIOUS) : null;
  }

  seal(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    return this.openWithKey(sealed).plaintext;
  }

  /** Whether a stored value was sealed with the previous key and should be re-sealed. */
  needsReseal(sealed: string): boolean {
    return this.openWithKey(sealed).previous;
  }

  private openWithKey(sealed: string): { plaintext: string; previous: boolean } {
    const [v, nonce, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !nonce || !tag || ct === undefined) throw new Error('Unrecognised secret format');
    const tryKey = (key: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
    };
    try {
      return { plaintext: tryKey(this.key), previous: false };
    } catch (err) {
      if (!this.previous) throw err;
      return { plaintext: tryKey(this.previous), previous: true };
    }
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
