import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { apiEnvSchema } from '@dealflow/config';
import { SECRET_BOX, type SecretBox } from './crypto';
import { API_ENV, type ApiEnv } from './env';
import { PrismaService } from './prisma.service';

/**
 * Deployment-wide provider keys an operator may enter in the console instead of the deployment's secrets (ADR 0051).
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
  SMTP_URL: { secret: true },
  MAIL_FROM: { secret: false },
  ZAPIER_INVITE_URL: { secret: false },
  STRIPE_SECRET_KEY: { secret: true },
  STRIPE_WEBHOOK_SECRET: { secret: true },
  RAZORPAY_KEY_ID: { secret: true },
  RAZORPAY_KEY_SECRET: { secret: true },
  RAZORPAY_WEBHOOK_SECRET: { secret: true },
  // Settings, not credentials: switches and ids an operator changes from the console (ADR 0053).
  AI_MODEL: { secret: false },
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
  return typeof parsed.data === 'string' && parsed.data ? { ok: true, value: parsed.data } : { ok: false, message: 'Not a valid value.' };
}

export interface ManagedKeyState {
  /** `default`: nobody set it, and the built-in default applies (a switch that is off, Microsoft's "common" tenant). */
  source: 'console' | 'environment' | 'default' | 'missing';
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
}

/**
 * Makes console-entered provider keys take effect without a restart.
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.refreshMs = (env.PROVIDER_KEYS_REFRESH_SECONDS ?? 10) * 1000;
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
        get: () => this.overrides.get(name)?.value ?? this.fromEnvironment.get(name),
        // Assigning replaces the environment value (the fallback); a console value still wins.
        set: (v: unknown) => {
          this.fromEnvironment.set(name, v);
        },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.refreshMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
            this.log.error({ name: r.name }, 'A provider setting saved in the console is no longer valid; using the environment value');
            continue;
          }
          next.set(r.name, { value, hint: r.hint, updatedAt: r.updatedAt, updatedById: r.updatedById });
        } catch {
          this.log.error({ name: r.name }, 'A provider key saved in the console cannot be decrypted with ENCRYPTION_KEY; using the environment value');
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
    if (o) return { source: 'console', hint: o.hint, updatedAt: o.updatedAt.toISOString(), updatedById: o.updatedById };
    const v = this.fromEnvironment.get(name);
    if (v === undefined || v === null || v === '') return { source: 'missing', hint: null, updatedAt: null, updatedById: null };
    const hint = hintFor(name, v as string | boolean | number);
    return { source: v === defaultOf(name) ? 'default' : 'environment', hint, updatedAt: null, updatedById: null };
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
