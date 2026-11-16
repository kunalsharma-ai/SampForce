import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SecretBox } from '../src/common/crypto';
import { ENCRYPTION_KEY_PREVIOUS_SETTING, ENCRYPTION_KEY_SETTING, loadServerSecrets, loadSigningSecrets, RETIRED_KEY_FINGERPRINTS, rotateEncryptionKey, rotateSigningSecrets, SIGNING_SECRET_NAMES } from '../src/common/server-secrets';
import { appClient } from './helpers';

/** ADR 0059: in production the session signing secrets live in the database, not the server's settings file. */
describe('session signing secrets stored in the database', () => {
  const key = randomBytes(32).toString('base64');
  const prod = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({ NODE_ENV: 'production', DATABASE_URL: process.env.DATABASE_URL, ENCRYPTION_KEY: key, ...extra });
  const clean = async () => {
    const db = appClient();
    await db.platformSecret.deleteMany({ where: { name: { in: [...SIGNING_SECRET_NAMES, 'HUNTER_API_KEY'] } } });
    await db.platformSetting.deleteMany({ where: { key: { in: [ENCRYPTION_KEY_SETTING, ENCRYPTION_KEY_PREVIOUS_SETTING, RETIRED_KEY_FINGERPRINTS] } } });
    await db.$disconnect();
  };
  beforeEach(clean);
  afterAll(clean);

  it('a new server generates both secrets once, seals them, and every later start (API, worker) reads the same ones', async () => {
    const api = prod();
    expect(await loadSigningSecrets(api)).toEqual({ created: ['JWT_ACCESS_SECRET', 'OPERATOR_JWT_SECRET'], imported: [] });
    expect(api.JWT_ACCESS_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(api.OPERATOR_JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(api.OPERATOR_JWT_SECRET).not.toBe(api.JWT_ACCESS_SECRET);

    const db = appClient();
    const row = await db.platformSecret.findUniqueOrThrow({ where: { name: 'JWT_ACCESS_SECRET' } });
    expect(row.valueEnc).not.toContain(api.JWT_ACCESS_SECRET!);
    expect(new SecretBox({ ENCRYPTION_KEY: key, JWT_ACCESS_SECRET: '' }).open(row.valueEnc)).toBe(api.JWT_ACCESS_SECRET);
    await db.$disconnect();

    // A restart, or the worker: same values, nothing new created, and a stale value left in the file is ignored.
    const worker = prod({ JWT_ACCESS_SECRET: 'a-different-value-left-in-the-settings-file' });
    expect(await loadSigningSecrets(worker)).toEqual({ created: [], imported: [] });
    expect(worker.JWT_ACCESS_SECRET).toBe(api.JWT_ACCESS_SECRET);
    expect(worker.OPERATOR_JWT_SECRET).toBe(api.OPERATOR_JWT_SECRET);
  });

  it('a server installed before ADR 0059 keeps its secrets (nobody is signed out): they are copied in from the file', async () => {
    const jwt = 'old-install-jwt-secret-0123456789abcdef';
    const op = 'old-install-operator-secret-0123456789ab';
    const env = prod({ JWT_ACCESS_SECRET: jwt, OPERATOR_JWT_SECRET: op });
    expect(await loadSigningSecrets(env)).toEqual({ created: [], imported: ['JWT_ACCESS_SECRET', 'OPERATOR_JWT_SECRET'] });
    // After that the file can lose them.
    const later = prod();
    await loadSigningSecrets(later);
    expect(later).toMatchObject({ JWT_ACCESS_SECRET: jwt, OPERATOR_JWT_SECRET: op });
  });

  it('the API and the worker starting at the same moment end up with the same secrets', async () => {
    const [a, b] = [prod(), prod()];
    await Promise.all([loadSigningSecrets(a), loadSigningSecrets(b)]);
    expect(a.JWT_ACCESS_SECRET).toBe(b.JWT_ACCESS_SECRET);
    expect(a.OPERATOR_JWT_SECRET).toBe(b.OPERATOR_JWT_SECRET);
    const db = appClient();
    expect(await db.platformSecret.count({ where: { name: { in: [...SIGNING_SECRET_NAMES] } } })).toBe(2);
    await db.$disconnect();
  });

  it('refuses to start with the wrong ENCRYPTION_KEY instead of signing with a new secret; does nothing outside production', async () => {
    await loadSigningSecrets(prod());
    await expect(loadSigningSecrets(prod({ ENCRYPTION_KEY: randomBytes(32).toString('base64') }))).rejects.toThrow('cannot be opened with ENCRYPTION_KEY');
    const dev = { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'dev-secret' };
    expect(await loadSigningSecrets(dev)).toEqual({ created: [], imported: [] });
    expect(dev.JWT_ACCESS_SECRET).toBe('dev-secret');
  });

  it('rotating replaces a secret with a new random one that the next start reads', async () => {
    const before = prod();
    await loadSigningSecrets(before);
    await rotateSigningSecrets(['JWT_ACCESS_SECRET'], prod());
    const after = prod();
    await loadSigningSecrets(after);
    expect(after.JWT_ACCESS_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(after.JWT_ACCESS_SECRET).not.toBe(before.JWT_ACCESS_SECRET);
    expect(after.OPERATOR_JWT_SECRET).toBe(before.OPERATOR_JWT_SECRET);
  });

  describe('ENCRYPTION_KEY stored in the database (Kunal chose it, 2026-11-16)', () => {
    const only = { NODE_ENV: 'production', DATABASE_URL: process.env.DATABASE_URL };
    const stored = async () => {
      const db = appClient();
      const row = await db.platformSetting.findUnique({ where: { key: ENCRYPTION_KEY_SETTING } });
      await db.$disconnect();
      return row?.value;
    };

    it('a new server with only the database connection generates the key, then the signing secrets sealed with it', async () => {
      const env: Record<string, string | undefined> = { ...only };
      expect(await loadServerSecrets(env)).toEqual({ encryptionKey: 'created', created: ['JWT_ACCESS_SECRET', 'OPERATOR_JWT_SECRET'], imported: [] });
      expect(Buffer.from(env.ENCRYPTION_KEY!, 'base64')).toHaveLength(32);
      expect(await stored()).toBe(env.ENCRYPTION_KEY);
      // The worker (or a restart) with the same nothing-but-the-database environment gets the same key and secrets.
      const worker: Record<string, string | undefined> = { ...only };
      expect(await loadServerSecrets(worker)).toEqual({ encryptionKey: 'database', created: [], imported: [] });
      expect(worker).toMatchObject({ ENCRYPTION_KEY: env.ENCRYPTION_KEY, JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET, OPERATOR_JWT_SECRET: env.OPERATOR_JWT_SECRET });
      expect(worker.ENCRYPTION_KEY_PREVIOUS).toBeUndefined();
    });

    it('an older install keeps its key: it is copied in from .env once, and the same value left there is harmless', async () => {
      const env: Record<string, string | undefined> = { ...only, ENCRYPTION_KEY: key };
      expect((await loadServerSecrets(env)).encryptionKey).toBe('imported');
      expect(await stored()).toBe(key);
      expect((await loadServerSecrets({ ...only, ENCRYPTION_KEY: key })).encryptionKey).toBe('database');
      expect((await loadServerSecrets({ ...only })).encryptionKey).toBe('database');
    });

    it('a different key in .env stops start-up instead of making every stored secret unreadable', async () => {
      await loadServerSecrets({ ...only, ENCRYPTION_KEY: key });
      await expect(loadServerSecrets({ ...only, ENCRYPTION_KEY: randomBytes(32).toString('base64') })).rejects.toThrow('not the key stored in the database');
      expect(await stored()).toBe(key);
      await expect(loadServerSecrets({ ...only, ENCRYPTION_KEY: 'short' })).rejects.toThrow('shorter than 32');
    });

    it('rotate-encryption-key: stored secrets stay readable at every step, nobody is signed out, an old .env copy is ignored', async () => {
      const first: Record<string, string | undefined> = { ...only, ENCRYPTION_KEY: key };
      await loadServerSecrets(first);
      const db = appClient();
      const box = new SecretBox({ ENCRYPTION_KEY: key, JWT_ACCESS_SECRET: '' });
      await db.platformSecret.create({ data: { name: 'HUNTER_API_KEY', valueEnc: box.seal('hunter-key-from-console-1234'), hint: '1234', fingerprint: 'x', updatedById: 'op' } });

      // Step 1: new key stored, old kept as previous, everything re-sealed.
      const started = await rotateEncryptionKey('start', { ...only }, { only: ['platform_secrets'] });
      expect(started['platform_secrets.value_enc']!.resealed).toBeGreaterThanOrEqual(3);
      const newKey = (await stored())!;
      expect(newKey).not.toBe(key);
      // A process restarted mid-rotation opens everything, and still signs with the same secrets.
      const mid: Record<string, string | undefined> = { ...only };
      await loadServerSecrets(mid);
      expect(mid).toMatchObject({ ENCRYPTION_KEY: newKey, ENCRYPTION_KEY_PREVIOUS: key, JWT_ACCESS_SECRET: first.JWT_ACCESS_SECRET });
      await expect(rotateEncryptionKey('start', { ...only })).rejects.toThrow('already in progress');

      // Step 2: forget the old key. Only the new key is needed from now on.
      await rotateEncryptionKey('finish', { ...only }, { only: ['platform_secrets'] });
      const after: Record<string, string | undefined> = { ...only };
      await loadServerSecrets(after);
      expect(after.ENCRYPTION_KEY_PREVIOUS).toBeUndefined();
      expect(after.JWT_ACCESS_SECRET).toBe(first.JWT_ACCESS_SECRET);
      const hunter = await db.platformSecret.findUniqueOrThrow({ where: { name: 'HUNTER_API_KEY' } });
      expect(new SecretBox({ ENCRYPTION_KEY: newKey, JWT_ACCESS_SECRET: '' }).open(hunter.valueEnc)).toBe('hunter-key-from-console-1234');
      expect(() => box.open(hunter.valueEnc)).toThrow();
      await db.$disconnect();

      // The old key still sitting in an old .env does not stop start-up and is not used.
      const stale: Record<string, string | undefined> = { ...only, ENCRYPTION_KEY: key };
      await loadServerSecrets(stale);
      expect(stale.ENCRYPTION_KEY).toBe(newKey);
    });
  });
});
