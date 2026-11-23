import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { apiEnvSchema } from '@dealflow/config';
import { SECRET_BOX, type SecretBox } from './crypto';
import { API_ENV, type ApiEnv } from './env';
import { PrismaService } from './prisma.service';
import { writePlatformAudit } from '../operator/platform-audit';

/**
 * Deployment-wide provider keys an operator enters in the console (ADR 0051); in production the database is their only home (ADR 0059).
 * `secret: false` marks settings that are not credentials (a sender address, a tenant name, a URL), which the console
 * shows in full; everything else is shown only as its last four characters.
 *
 * ENCRYPTION_KEY, JWT secrets and DATABASE_URL are deliberately absent: they protect the console itself.
 */
export const MANAGED_KEYS = {
  APOLLO_API_KEY: { secret: true },
  HUNTER_API_KEY: { secret: true },
  DEEPGRAM_API_KEY: { secret: true },
  GOOGLE_CLIENT_ID: { secret: true },
  GOOGLE_CLIENT_SECRET: { secret: true },
  MICROSOFT_CLIENT_ID: { secret: true },
  MICROSOFT_CLIENT_SECRET: { secret: true },
  MICROSOFT_TENANT: { secret: false },
  SLACK_CLIENT_ID: { secret: true },
  SLACK_CLIENT_SECRET: { secret: true },
  ZOOM_CLIENT_ID: { secret: true },
  ZOOM_CLIENT_SECRET: { secret: true },
  ZOOM_WEBHOOK_SECRET_TOKEN: { secret: true },
  DOCUSIGN_INTEGRATION_KEY: { secret: true },
  DOCUSIGN_SECRET_KEY: { secret: true },
  DOCUSIGN_CONNECT_HMAC_KEY: { secret: true },
  DOCUSIGN_AUTH_BASE_URL: { secret: false },
  ANTHROPIC_API_KEY: { secret: true },
  OPENAI_API_KEY: { secret: true },
  GEMINI_API_KEY: { secret: true },
  GROQ_API_KEY: { secret: true },
  OPENROUTER_API_KEY: { secret: true },
  MISTRAL_API_KEY: { secret: true },
  CUSTOM_AI_API_KEY: { secret: true },
  SMTP_URL: { secret: true },
  SMTP_HOST: { secret: false },
  SMTP_PORT: { secret: false },
  SMTP_SECURE: { secret: false },
  SMTP_USER: { secret: false },
  SMTP_PASSWORD: { secret: true },
  MAIL_FROM: { secret: false },
  ZAPIER_INVITE_URL: { secret: false },
  EXPO_ACCESS_TOKEN: { secret: true },
  STRIPE_SECRET_KEY: { secret: true },
  STRIPE_WEBHOOK_SECRET: { secret: true },
  RAZORPAY_KEY_ID: { secret: true },
  RAZORPAY_KEY_SECRET: { secret: true },
  RAZORPAY_WEBHOOK_SECRET: { secret: true },
  // Settings, not credentials: switches and ids an operator changes from the console (ADR 0053).
  AI_MODEL: { secret: false },
  OPENAI_MODEL: { secret: false },
  GEMINI_MODEL: { secret: false },
  GROQ_MODEL: { secret: false },
  OPENROUTER_MODEL: { secret: false },
  MISTRAL_MODEL: { secret: false },
  CUSTOM_AI_BASE_URL: { secret: false },
  CUSTOM_AI_MODEL: { secret: false },
  AI_PROVIDER_ORDER: { secret: false },
  TRUSTED_PRIVATE_HOSTS: { secret: false },
  ONLINE_PAYMENTS_ENABLED: { secret: false },
  STRIPE_PRICES: { secret: false },
  STRIPE_AUTOMATIC_TAX: { secret: false },
  RAZORPAY_PLANS: { secret: false },
  PRICING_PUBLISHED: { secret: false },
  SALES_CONTACT_EMAIL: { secret: false },
} as const satisfies Partial<Record<keyof ApiEnv, { secret: boolean }>>;

export type ManagedKeyName = keyof typeof MANAGED_KEYS;
export const MANAGED_KEY_NAMES = Object.keys(MANAGED_KEYS) as ManagedKeyName[];
export const isManagedKey = (name: string): name is ManagedKeyName => Object.hasOwn(MANAGED_KEYS, name);

/** First 12 hex characters of SHA-256: enough to tell keys apart, useless for recovering one. */
export function fingerprintOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/** What the console may show for a value: a non-secret in full, a secret as its last four characters (none if short). */
export function hintFor(name: ManagedKeyName, value: string | boolean | number): string | null {
  const text = String(value);
  if (!MANAGED_KEYS[name].secret) return text;
  return text.length >= 12 ? text.slice(-4) : null;
}

/** The typed value a stored console string stands for (a switch is stored as "true"/"false" and read as a boolean). */
function typedValue(name: ManagedKeyName, raw: string): unknown {
  const parsed = apiEnvSchema.shape[name].safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** The value a setting has when neither the console nor the environment sets it, if it has one. */
export function defaultOf(name: ManagedKeyName): unknown {
  const parsed = apiEnvSchema.shape[name].safeParse(undefined);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Validates a console value with the same rule the environment variable has, so a key that would stop the API
 * starting from the environment cannot be saved here either. Returns the normalised value, or an error message.
 */
export function parseManagedValue(name: ManagedKeyName, raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value) return { ok: false, message: 'Enter a value, or remove the console value instead.' };
  if (value.length > 4096) return { ok: false, message: 'Too long (4,096 characters at most).' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, message: 'Line breaks and control characters are not allowed.' };
  const parsed = apiEnvSchema.shape[name].safeParse(value);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Not a valid value.' };
  // Switches are stored in one spelling ("true"/"false") whatever was typed ("1", "0").
  if (typeof parsed.data === 'boolean') return { ok: true, value: String(parsed.data) };
  // Numbers (a port) are stored as the number they were read as.
  if (typeof parsed.data === 'number') return { ok: true, value: String(parsed.data) };
  return typeof parsed.data === 'string' && parsed.data ? { ok: true, value: parsed.data } : { ok: false, message: 'Not a valid value.' };
}

export interface ManagedKeyState {
  /**
   * `default`: nobody set it, and the built-in default applies (a switch that is off, Microsoft's "common" tenant).
   * `environment` only outside production: in production the database is the only source (ADR 0059).
   */
  source: 'console' | 'environment' | 'default' | 'missing';
  /** The console value was copied from the server's environment file at start-up, not typed into the console. */
  imported: boolean;
  hint: string | null;
  updatedAt: string | null;
  updatedById: string | null;
}

interface Override {
  /** The typed value services read (a boolean for a switch). */
  value: unknown;
  hint: string | null;
  updatedAt: Date;
  updatedById: string | null;
  imported: boolean;
}

/** platform_settings key recording that an environment value was copied into the database once (by fingerprint). */
export const ENV_IMPORT_PREFIX = 'env_import:';

/**
 * Makes console-entered provider keys take effect without a restart, and makes the database their only home.
 *
 * In production (NODE_ENV=production) the database is the only source of every managed key (ADR 0059): a value
 * still found in the environment at start-up is copied into `platform_secrets` once, sealed, and from then on the
 * environment is ignored, so removing a key in the console really removes it. Outside production the environment
 * stays a fallback, because local development and the test suite point providers at local stand-ins that way.
 *
 * Services read keys from the injected ApiEnv at the moment they call a provider (`this.env.SLACK_CLIENT_SECRET`).
 * This service turns each managed name on that object into a getter: the value saved in `platform_secrets`, if any,
 * otherwise the environment variable the process started with. Saved values are decrypted into memory and reloaded
 * every PROVIDER_KEYS_REFRESH_SECONDS (default 10), and at once in the process that saved them, so the API, the worker
 * and every replica pick up a change within seconds. Values never leave this process except to the provider.
 */
@Injectable()
export class ProviderKeysService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(ProviderKeysService.name);
  private readonly fromEnvironment = new Map<ManagedKeyName, unknown>();
  private overrides = new Map<ManagedKeyName, Override>();
  private timer: NodeJS.Timeout | null = null;
  private loaded = false;
  readonly refreshMs: number;
  /** True in production: environment values are imported once and otherwise ignored. */
  readonly databaseOnly: boolean;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.refreshMs = (env.PROVIDER_KEYS_REFRESH_SECONDS ?? 10) * 1000;
    this.databaseOnly = env.NODE_ENV === 'production';
    this.install();
  }

  /** Replaces each managed property with a getter. Runs in the constructor, before any service makes a call. */
  private install(): void {
    const target = this.env as unknown as Record<string, unknown>;
    for (const name of MANAGED_KEY_NAMES) {
      const desc = Object.getOwnPropertyDescriptor(target, name);
      if (desc?.get) continue; // already installed on this object
      this.fromEnvironment.set(name, target[name]);
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get: () => this.overrides.get(name)?.value ?? (this.databaseOnly ? defaultOf(name) : this.fromEnvironment.get(name)),
        // Assigning replaces the environment value (the fallback); a console value still wins.
        set: (v: unknown) => {
          this.fromEnvironment.set(name, v);
        },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.databaseOnly) await this.importFromEnvironment();
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Production only: copies each managed key still set in the environment into the database, sealed, so a server
   * installed before ADR 0059 keeps working after the environment stops being read. A key is copied only when the
   * console has no value for it and this exact value (by fingerprint) was not copied before, so a key an operator
   * removed in the console does not come back on the next restart. The API and the worker may both run this at once:
   * the create is conditional, and the loser of the race simply finds the row already there.
   */
  async importFromEnvironment(): Promise<ManagedKeyName[]> {
    const imported: ManagedKeyName[] = [];
    for (const name of MANAGED_KEY_NAMES) {
      const raw = this.fromEnvironment.get(name);
      if (raw === undefined || raw === null || raw === '') continue;
      if (raw === defaultOf(name)) continue; // the built-in default applies anyway
      const parsed = parseManagedValue(name, String(raw));
      if (!parsed.ok) {
        this.log.error({ name }, 'A provider setting in the environment is not valid and was not copied into the database');
        continue;
      }
      const fingerprint = fingerprintOf(parsed.value);
      const markerKey = `${ENV_IMPORT_PREFIX}${name}`;
      const marker = await this.prisma.platformSetting.findUnique({ where: { key: markerKey } });
      if (marker?.value === fingerprint) continue;
      const existing = await this.prisma.platformSecret.findUnique({ where: { name }, select: { name: true } });
      if (!existing) {
        try {
          const hint = hintFor(name, parsed.value);
          await this.prisma.platformSecret.create({ data: { name, valueEnc: this.box.seal(parsed.value), hint, fingerprint, updatedById: null } });
          imported.push(name);
          // The operator log shows where the value came from; like a console save it holds the fingerprint, never the value.
          await writePlatformAudit(this.prisma, { operatorId: null, action: 'provider_key.imported', target: { type: 'provider_key', id: name, label: name }, metadata: { name, fingerprint, source: 'environment', ...(MANAGED_KEYS[name].secret ? { last4: hint } : { value: hint }) } });
        } catch (err) {
          // Another process (the worker, a second replica) imported it at the same moment.
          if ((err as { code?: string }).code !== 'P2002') throw err;
        }
      }
      await this.prisma.platformSetting.upsert({ where: { key: markerKey }, create: { key: markerKey, value: fingerprint }, update: { value: fingerprint } });
    }
    if (imported.length) {
      this.log.warn(
        { names: imported },
        'Provider keys found in the environment were copied into the database. The environment is no longer read for them: delete them from sampforce.env (or the Kubernetes Secret) and manage them in the operator console under Providers.',
      );
    }
    return imported;
  }

  /** Reloads console values. A value that cannot be opened (wrong ENCRYPTION_KEY) is skipped and logged, never used. */
  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.platformSecret.findMany();
      const next = new Map<ManagedKeyName, Override>();
      for (const r of rows) {
        if (!isManagedKey(r.name)) continue;
        try {
          const value = typedValue(r.name, this.box.open(r.valueEnc));
          if (value === undefined) {
            this.log.error({ name: r.name }, 'A provider setting saved in the console is no longer valid; ignoring it');
            continue;
          }
          next.set(r.name, { value, hint: r.hint, updatedAt: r.updatedAt, updatedById: r.updatedById, imported: r.updatedById === null });
        } catch {
          this.log.error({ name: r.name }, 'A provider key saved in the console cannot be decrypted with ENCRYPTION_KEY; ignoring it');
        }
      }
      this.overrides = next;
      this.loaded = true;
    } catch (err) {
      // Keep serving the last good values; the next refresh tries again.
      if (this.loaded) this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Provider keys refresh failed');
      else throw err;
    }
  }

  state(name: ManagedKeyName): ManagedKeyState {
    const o = this.overrides.get(name);
    if (o) return { source: 'console', hint: o.hint, updatedAt: o.updatedAt.toISOString(), updatedById: o.updatedById, imported: o.imported };
    const v = this.databaseOnly ? defaultOf(name) : this.fromEnvironment.get(name);
    if (v === undefined || v === null || v === '') return { source: 'missing', hint: null, updatedAt: null, updatedById: null, imported: false };
    const hint = hintFor(name, v as string | boolean | number);
    return { source: v === defaultOf(name) ? 'default' : 'environment', hint, updatedAt: null, updatedById: null, imported: false };
  }

  /** Saves (string) or removes (null) console values in one transaction, then applies them in this process at once. */
  async apply(changes: Partial<Record<ManagedKeyName, string | null>>, operatorId: string): Promise<{ name: ManagedKeyName; action: 'set' | 'cleared'; fingerprint: string | null; hint: string | null }[]> {
    const done: { name: ManagedKeyName; action: 'set' | 'cleared'; fingerprint: string | null; hint: string | null }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const [name, value] of Object.entries(changes) as [ManagedKeyName, string | null][]) {
        if (value === null) {
          const { count } = await tx.platformSecret.deleteMany({ where: { name } });
          if (count) done.push({ name, action: 'cleared', fingerprint: null, hint: null });
          continue;
        }
        const data = { valueEnc: this.box.seal(value), hint: hintFor(name, value), fingerprint: fingerprintOf(value), updatedById: operatorId };
        await tx.platformSecret.upsert({ where: { name }, create: { name, ...data }, update: data });
        done.push({ name, action: 'set', fingerprint: data.fingerprint, hint: data.hint });
      }
    });
    await this.refresh();
    return done;
  }
}
