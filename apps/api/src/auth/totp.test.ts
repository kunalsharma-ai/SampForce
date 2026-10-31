import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateSecret, hotp, otpauthUri, stepAt, verifyTotp } from './totp';

// RFC 6238 appendix B (SHA-1 seed "12345678901234567890", 8 digits).
const SEED = Buffer.from('12345678901234567890');
const VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    for (const [t, code] of VECTORS) expect(hotp(SEED, stepAt(t), 8)).toBe(code);
  });

  it('matches the RFC 4226 HOTP test values', () => {
    expect([0, 1, 2, 9].map((c) => hotp(SEED, c))).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('round-trips base32 and generates 160-bit secrets', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it('accepts the current step and one either side, and refuses replays', () => {
    const secret = base32Encode(SEED);
    const now = 1111111111;
    const code = hotp(SEED, stepAt(now));
    expect(verifyTotp(secret, code, { now })).toBe(stepAt(now));
    expect(verifyTotp(secret, hotp(SEED, stepAt(now) - 1), { now })).toBe(stepAt(now) - 1);
    expect(verifyTotp(secret, hotp(SEED, stepAt(now) - 2), { now })).toBeNull();
    expect(verifyTotp(secret, code, { now, lastStep: stepAt(now) })).toBeNull();
    expect(verifyTotp(secret, '12345', { now })).toBeNull();
  });

  it('builds an otpauth URI and readable recovery codes', () => {
    expect(otpauthUri('ABC', 'ada@example.com')).toBe(
      'otpauth://totp/DealFlow%3Aada%40example.com?secret=ABC&issuer=DealFlow&algorithm=SHA1&digits=6&period=30',
    );
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });
});
