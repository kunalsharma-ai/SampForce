import { describe, expect, it } from 'vitest';
import { SecretBox, signToken, verifyToken } from './crypto';
import { createServer } from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { assertPublicUrl, guardedLookup, isPrivateAddress, publicAgentFor, UnsafeTargetError } from './net-guard';

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

  it('opens values sealed with the previous key during a rotation', () => {
    const oldKey = 'a'.repeat(64);
    const newKey = 'b'.repeat(64);
    const sealedOld = new SecretBox({ ...env, ENCRYPTION_KEY: oldKey }).seal('totp-secret');
    const rotating = new SecretBox({ ...env, ENCRYPTION_KEY: newKey, ENCRYPTION_KEY_PREVIOUS: oldKey });
    expect(rotating.open(sealedOld)).toBe('totp-secret');
    expect(rotating.needsReseal(sealedOld)).toBe(true);
    const resealed = rotating.seal('totp-secret');
    expect(rotating.needsReseal(resealed)).toBe(false);
    expect(new SecretBox({ ...env, ENCRYPTION_KEY: newKey }).open(resealed)).toBe('totp-secret');
    expect(() => new SecretBox({ ...env, ENCRYPTION_KEY: newKey }).open(sealedOld)).toThrow();
  });

  it('verifies signed state', () => {
    const t = signToken('secret', { u: 1 });
    expect(verifyToken('secret', t)).toEqual({ u: 1 });
    expect(verifyToken('other', t)).toBeNull();
    expect(verifyToken('secret', t.slice(0, -2) + 'xx')).toBeNull();
  });
});

describe('guardedLookup (connection-time check against DNS rebinding)', () => {
  const run = (lookup: LookupFunction, options: { all?: boolean; family?: number }) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) =>
      lookup('hooks.example.com', options as never, ((err: Error | null, address: unknown, family?: number) => resolve({ err, result: options.all ? address : { address, family } })) as never),
    );

  it('passes public addresses through, honouring family and all', async () => {
    const lookup = guardedLookup(async () => [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }]);
    expect(await run(lookup, {})).toEqual({ err: null, result: { address: '93.184.216.34', family: 4 } });
    expect(await run(lookup, { family: 6 })).toEqual({ err: null, result: { address: '2606:2800:220:1::1', family: 6 } });
    expect((await run(lookup, { all: true })).result).toHaveLength(2);
  });

  it('refuses when any address is private, and when nothing resolves', async () => {
    const mixed = await run(guardedLookup(async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]), { all: true });
    expect(mixed.err).toBeInstanceOf(UnsafeTargetError);
    const none = await run(guardedLookup(async () => []), {});
    expect((none.err as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });

  it('a host that resolves to an internal address at request time never gets a connection', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end('internal');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const toLoopback: LookupFunction = (_h, o, cb) => ((o as { all?: boolean }).all ? (cb as never as (e: null, a: unknown) => void)(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
    try {
      // Control: the same "rebinding" answer without the guard reaches the internal server.
      const plain = new Agent({ connect: { lookup: toLoopback } });
      expect(await (await undiciFetch(`http://rebind.example:${port}/`, { dispatcher: plain })).text()).toBe('internal');
      expect(hits).toBe(1);
      // With the guard, the connection is refused before any byte is sent.
      const guarded = publicAgentFor(async () => [{ address: '127.0.0.1', family: 4 }]);
      const err = await undiciFetch(`http://rebind.example:${port}/`, { dispatcher: guarded }).then(() => null, (e: Error) => e);
      expect(err).not.toBeNull();
      expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(UnsafeTargetError);
      expect(hits).toBe(1);
      await plain.close();
      await guarded.close();
    } finally {
      server.close();
    }
  });
});
