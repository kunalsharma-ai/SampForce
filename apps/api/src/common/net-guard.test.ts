import { describe, expect, it } from 'vitest';
import { SecretBox, signToken, verifyToken } from './crypto';
import { assertPublicUrl, isPrivateAddress } from './net-guard';

describe('isPrivateAddress', () => {
  it('flags loopback, private, link-local and metadata ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('refuses private, credentialed and non-https targets', async () => {
    await expect(assertPublicUrl('https://127.0.0.1/hook', false)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://[::1]/hook', false)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://8.8.8.8/hook', false)).rejects.toThrow(/https/);
    await expect(assertPublicUrl('https://u:p@8.8.8.8/', false)).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl('ftp://8.8.8.8/', false)).rejects.toThrow(/http/);
    await expect(assertPublicUrl('https://8.8.8.8/hook', false)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl('http://127.0.0.1:9/hook', true)).resolves.toBeInstanceOf(URL);
  });
});

describe('SecretBox and signed tokens', () => {
  const env = { JWT_ACCESS_SECRET: 'x'.repeat(40), ENCRYPTION_KEY: undefined };

  it('round-trips and detects tampering', () => {
    const box = new SecretBox(env);
    const sealed = box.seal('refresh-token-123');
    expect(sealed).not.toContain('refresh-token');
    expect(box.open(sealed)).toBe('refresh-token-123');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() => new SecretBox({ ...env, ENCRYPTION_KEY: 'a'.repeat(64) }).open(sealed)).toThrow();
  });

  it('verifies signed state', () => {
    const t = signToken('secret', { u: 1 });
    expect(verifyToken('secret', t)).toEqual({ u: 1 });
    expect(verifyToken('other', t)).toBeNull();
    expect(verifyToken('secret', t.slice(0, -2) + 'xx')).toBeNull();
  });
});
