import { createHash } from 'node:crypto';

/** Results of the operator console's provider checks, kept in platform_settings (one row per provider). */
export const PROVIDER_CHECK_PREFIX = 'provider_check:';

export interface StoredCheck {
  ok: boolean;
  at: string;
  message: string;
  by: string | null;
  /** A short one-way fingerprint of the key the check used, so a check never vouches for a different key. */
  key: string | null;
}

/** First 12 hex characters of SHA-256 of the key: enough to tell keys apart, useless for recovering one. */
export function keyFingerprint(key: string | undefined | null): string | null {
  return key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : null;
}

export function readProviderCheck(value: string | null | undefined): StoredCheck | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<StoredCheck>;
    return typeof v.ok === 'boolean' && typeof v.at === 'string' ? { ok: v.ok, at: v.at, message: String(v.message ?? ''), by: v.by ?? null, key: typeof v.key === 'string' ? v.key : null } : null;
  } catch {
    return null;
  }
}

/** The stored check, only when it was made with the key that is set now. */
export function currentCheck(check: StoredCheck | null, key: string | undefined | null): StoredCheck | null {
  return check && check.key !== null && check.key === keyFingerprint(key) ? check : null;
}
