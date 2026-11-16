import { randomBytes } from 'node:crypto';
import { createPrismaClient } from '@dealflow/database';
import { SecretBox } from './crypto';
import { fingerprintOf } from './provider-keys';
import { type ResealCounts, resealAll } from './reseal';

type Prisma = ReturnType<typeof createPrismaClient>;
type Env = Record<string, string | undefined>;

/**
 * Where a production server keeps ENCRYPTION_KEY (ADR 0059, Kunal's choice on 2026-11-16): in the database, so the
 * server's settings file holds only the database connection. `platform_settings` stores it as is: it cannot be sealed
 * with itself. The trade-off, accepted by Kunal: a copy of the database (a backup file) now carries the key to every
 * secret in it, so backups must be kept as private as the keys themselves.
 */
export const ENCRYPTION_KEY_SETTING = 'server:encryption_key';
/** The key being retired while rotate-encryption-key runs; removed when it finishes. */
export const ENCRYPTION_KEY_PREVIOUS_SETTING = 'server:encryption_key_previous';
/** Fingerprints (never the keys) of keys rotated away, so an old copy left in a settings file is recognised and ignored. */
export const RETIRED_KEY_FINGERPRINTS = 'server:encryption_key_retired';

export type EncryptionKeySource = 'database' | 'created' | 'imported' | 'rotated';

/**
 * Production only: reads ENCRYPTION_KEY from the database and puts it (and the previous key during a rotation) in `env`.
 *
 * - Stored: that key is used. The same key still in the environment is harmless and can be deleted.
 * - Not stored, but in the environment (a server installed before ADR 0059): it is copied in.
 * - Neither (a new server): 32 random bytes are generated and stored. Nobody ever types one.
 * - A different key in the environment stops start-up, because using it would make every stored secret unreadable and
 *   silently replacing the stored one could lose it for good. The one exception is the old manual rotation
 *   (docs/runbooks/key-rotation.md): the new key in ENCRYPTION_KEY and the stored key in ENCRYPTION_KEY_PREVIOUS.
 */
export async function loadEncryptionKey(
  prisma: Prisma,
  env: Env = process.env,
): Promise<EncryptionKeySource> {
  const fromEnv = env.ENCRYPTION_KEY?.trim() || undefined;
  if (fromEnv && fromEnv.length < 32)
    throw new Error(
      'ENCRYPTION_KEY in the environment is shorter than 32 characters. Delete it from the settings file: the key is kept in the database.',
    );
  let source: EncryptionKeySource = 'database';
  let stored = await prisma.platformSetting.findUnique({ where: { key: ENCRYPTION_KEY_SETTING } });
  if (!stored) {
    const value = fromEnv ?? randomBytes(32).toString('base64');
    try {
      stored = await prisma.platformSetting.create({
        data: { key: ENCRYPTION_KEY_SETTING, value },
      });
      source = fromEnv ? 'imported' : 'created';
    } catch (err) {
      // The API and the worker started at the same moment; use the key the other one stored.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      stored = await prisma.platformSetting.findUniqueOrThrow({
        where: { key: ENCRYPTION_KEY_SETTING },
      });
    }
  } else if (fromEnv && fromEnv !== stored.value) {
    const retired = await prisma.platformSetting.findUnique({
      where: { key: ENCRYPTION_KEY_PREVIOUS_SETTING },
    });
    if (
      retired?.value === fromEnv ||
      (await prisma.platformSetting.findUnique({ where: { key: RETIRED_KEY_FINGERPRINTS } }))?.value
        .split(',')
        .includes(fingerprintOf(fromEnv))
    ) {
      // A key rotate-encryption-key replaced, still left in an old settings file: ignore it.
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'Ignoring an old ENCRYPTION_KEY left in the server settings file (it was rotated). Delete it from the file.',
        }),
      );
    } else if (env.ENCRYPTION_KEY_PREVIOUS?.trim() !== stored.value) {
      throw new Error(
        'ENCRYPTION_KEY in the environment is not the key stored in the database, so the stored secrets could not be opened with it. Delete ENCRYPTION_KEY from the server settings file (the database already holds the key), or rotate keys with scripts/rotate-encryption-key.sh.',
      );
    } else {
      await prisma.platformSetting.upsert({
        where: { key: ENCRYPTION_KEY_PREVIOUS_SETTING },
        create: { key: ENCRYPTION_KEY_PREVIOUS_SETTING, value: stored.value },
        update: { value: stored.value },
      });
      stored = await prisma.platformSetting.update({
        where: { key: ENCRYPTION_KEY_SETTING },
        data: { value: fromEnv },
      });
      source = 'rotated';
    }
  }
  const previous = await prisma.platformSetting.findUnique({
    where: { key: ENCRYPTION_KEY_PREVIOUS_SETTING },
  });
  env.ENCRYPTION_KEY = stored.value;
  const previousValue = env.ENCRYPTION_KEY_PREVIOUS?.trim() || previous?.value;
  if (previousValue && previousValue !== stored.value) env.ENCRYPTION_KEY_PREVIOUS = previousValue;
  else delete env.ENCRYPTION_KEY_PREVIOUS;
  return source;
}

/**
 * Production only: everything a server needs before it starts that is not the database connection itself, read from
 * the database (ADR 0059): ENCRYPTION_KEY first, then the session signing secrets sealed with it. Runs first in the
 * API, the worker and the command-line tools that need the key.
 */
export async function loadServerSecrets(
  env: Env = process.env,
): Promise<{
  encryptionKey: EncryptionKeySource | null;
  created: SigningSecretName[];
  imported: SigningSecretName[];
}> {
  if (env.NODE_ENV !== 'production') return { encryptionKey: null, created: [], imported: [] };
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const prisma = createPrismaClient(env.DATABASE_URL);
  let encryptionKey: EncryptionKeySource;
  try {
    encryptionKey = await loadEncryptionKey(prisma, env);
  } finally {
    await prisma.$disconnect();
  }
  if (encryptionKey !== 'database')
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: `ENCRYPTION_KEY is stored in the database (${encryptionKey}, ADR 0059). It can be deleted from the server settings file.`,
      }),
    );
  return { encryptionKey, ...(await loadSigningSecrets(env)) };
}

/**
 * The secrets that sign sessions, kept in the database instead of the server's settings file (ADR 0059).
 *
 * They are stored in `platform_secrets` next to the provider keys, sealed with ENCRYPTION_KEY (so a copy of the
 * database alone cannot forge a sign-in) and covered by reseal-secrets on a key rotation. They are not provider keys:
 * the console never lists or edits them.
 */
export const SIGNING_SECRET_NAMES = ['JWT_ACCESS_SECRET', 'OPERATOR_JWT_SECRET'] as const;
export type SigningSecretName = (typeof SIGNING_SECRET_NAMES)[number];

/**
 * Production only: makes the database the home of the signing secrets, then puts them in `env` (process.env by
 * default) so the rest of start-up reads them as before. Runs before the API, the worker or a command-line tool loads
 * its settings.
 *
 * - Saved in the database: that value is used; a value still in the environment is ignored.
 * - Not saved yet, but in the environment (a server installed before ADR 0059): it is copied in, so nobody is signed out.
 * - Neither (a new server): a random 32-byte value is generated and saved. Nobody ever has to type one.
 *
 * The API and the worker may start at the same moment: the create is conditional, and the process that loses the
 * race reads the winner's value, so both always sign with the same secret.
 */
export async function loadSigningSecrets(
  env: Env = process.env,
): Promise<{ created: SigningSecretName[]; imported: SigningSecretName[] }> {
  const result = { created: [] as SigningSecretName[], imported: [] as SigningSecretName[] };
  if (env.NODE_ENV !== 'production') return result;
  if (!env.ENCRYPTION_KEY)
    throw new Error(
      'ENCRYPTION_KEY is required (loadServerSecrets reads it from the database first).',
    );
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const box = new SecretBox({
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    ENCRYPTION_KEY_PREVIOUS: env.ENCRYPTION_KEY_PREVIOUS || undefined,
    JWT_ACCESS_SECRET: '',
  });
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    for (const name of SIGNING_SECRET_NAMES) {
      const fromEnv = env[name]?.trim();
      let row = await prisma.platformSecret.findUnique({ where: { name } });
      if (!row) {
        const usable =
          fromEnv &&
          fromEnv.length >= 32 &&
          !(name === 'OPERATOR_JWT_SECRET' && fromEnv === env.JWT_ACCESS_SECRET);
        const value = usable ? fromEnv : randomBytes(32).toString('hex');
        try {
          row = await prisma.platformSecret.create({
            data: {
              name,
              valueEnc: box.seal(value),
              hint: null,
              fingerprint: fingerprintOf(value),
              updatedById: null,
            },
          });
          (usable ? result.imported : result.created).push(name);
        } catch (err) {
          if ((err as { code?: string }).code !== 'P2002') throw err;
          row = await prisma.platformSecret.findUniqueOrThrow({ where: { name } });
        }
      }
      let value: string;
      try {
        value = box.open(row.valueEnc);
      } catch {
        throw new Error(
          `${name} is saved in the database but cannot be opened with ENCRYPTION_KEY (docs/runbooks/key-rotation.md).`,
        );
      }
      env[name] = value;
    }
  } finally {
    await prisma.$disconnect();
  }
  if (result.created.length || result.imported.length) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Session signing secrets are now stored in the database (ADR 0059). JWT_ACCESS_SECRET and OPERATOR_JWT_SECRET can be deleted from the server settings file.',
        created: result.created,
        copiedFromEnvironment: result.imported,
      }),
    );
  }
  return result;
}

/**
 * Replaces signing secrets with new random values (docs/runbooks/key-rotation.md). The API and the worker read them at
 * start-up, so they take effect after a restart: everyone's access token then fails once and is refreshed, and
 * operators sign in again.
 */
export async function rotateSigningSecrets(
  names: readonly SigningSecretName[],
  env: Env = process.env,
): Promise<void> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    if (env.NODE_ENV === 'production') await loadEncryptionKey(prisma, env);
    if (!env.ENCRYPTION_KEY) throw new Error('Set ENCRYPTION_KEY.');
    const box = new SecretBox({ ENCRYPTION_KEY: env.ENCRYPTION_KEY, JWT_ACCESS_SECRET: '' });
    for (const name of names) {
      const value = randomBytes(32).toString('hex');
      const data = {
        valueEnc: box.seal(value),
        hint: null,
        fingerprint: fingerprintOf(value),
        updatedById: null,
      };
      await prisma.platformSecret.upsert({
        where: { name },
        create: { name, ...data },
        update: data,
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Rotates the ENCRYPTION_KEY stored in the database (production, ADR 0059), in two steps so no secret is ever
 * unreadable:
 *
 * - `start`: stores a new random key, keeps the old one as the previous key, and re-seals every stored secret with the
 *   new key. Processes still running keep sealing with the old key until restarted; both keys open everything.
 * - `finish` (after the API and the worker are restarted): re-seals anything sealed in between, then forgets the old key.
 */
export async function rotateEncryptionKey(
  step: 'start' | 'finish',
  env: Env = process.env,
  opts: { only?: string[] } = {},
): Promise<ResealCounts> {
  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    const current = await prisma.platformSetting.findUnique({
      where: { key: ENCRYPTION_KEY_SETTING },
    });
    if (!current)
      throw new Error('No ENCRYPTION_KEY is stored in the database yet: start the API once first.');
    const previous = await prisma.platformSetting.findUnique({
      where: { key: ENCRYPTION_KEY_PREVIOUS_SETTING },
    });
    if (step === 'start') {
      if (previous)
        throw new Error(
          'A rotation is already in progress: restart the API and the worker, then run the finish step.',
        );
      const next = randomBytes(32).toString('base64');
      await prisma.platformSetting.create({
        data: { key: ENCRYPTION_KEY_PREVIOUS_SETTING, value: current.value },
      });
      await prisma.platformSetting.update({
        where: { key: ENCRYPTION_KEY_SETTING },
        data: { value: next },
      });
      const box = new SecretBox({
        ENCRYPTION_KEY: next,
        ENCRYPTION_KEY_PREVIOUS: current.value,
        JWT_ACCESS_SECRET: '',
      });
      return (await resealAll(box, prisma, opts)).counts;
    }
    if (!previous) return {};
    const box = new SecretBox({
      ENCRYPTION_KEY: current.value,
      ENCRYPTION_KEY_PREVIOUS: previous.value,
      JWT_ACCESS_SECRET: '',
    });
    const { counts } = await resealAll(box, prisma, opts);
    const retired = await prisma.platformSetting.findUnique({
      where: { key: RETIRED_KEY_FINGERPRINTS },
    });
    const list = [
      ...new Set([
        ...(retired?.value.split(',').filter(Boolean) ?? []),
        fingerprintOf(previous.value),
      ]),
    ].join(',');
    await prisma.platformSetting.upsert({
      where: { key: RETIRED_KEY_FINGERPRINTS },
      create: { key: RETIRED_KEY_FINGERPRINTS, value: list },
      update: { value: list },
    });
    await prisma.platformSetting.delete({ where: { key: ENCRYPTION_KEY_PREVIOUS_SETTING } });
    return counts;
  } finally {
    await prisma.$disconnect();
  }
}
