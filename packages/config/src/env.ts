import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Connection used at runtime. Must be a role WITHOUT BYPASSRLS so row-level security applies. */
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default('false'),
  /** Comma-separated origins allowed to call the API with credentials. */
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Escape hatch for running the production image over plain http on localhost only. */
  ALLOW_INSECURE_COOKIES: bool.default('false'),
  /** 32-byte key (base64 or hex) for encrypting webhook secrets and mailbox tokens. Required in production. */
  ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Public URL of the web app, used for OAuth redirect URIs and links in notifications. */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Runs the background worker inside the API process (development and e2e only). */
  RUN_WORKER_IN_PROCESS: bool.default('false'),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
  /** Lets webhooks and adapters reach private network addresses. Test fixtures only; refused in production. */
  ALLOW_PRIVATE_NETWORK_TARGETS: bool.default('false'),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  /** Consecutive failed deliveries after which a webhook is switched off. */
  WEBHOOK_DISABLE_AFTER_FAILURES: z.coerce.number().int().min(1).default(15),
  /** Emails one user may send per day from a connected mailbox. */
  EMAIL_DAILY_SEND_LIMIT: z.coerce.number().int().min(1).max(2000).default(200),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default('common'),
  /** Override provider endpoints (tests point these at a local fixture server). */
  GOOGLE_AUTH_BASE_URL: z.string().url().default('https://accounts.google.com'),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GOOGLE_API_BASE_URL: z.string().url().default('https://www.googleapis.com'),
  GMAIL_API_BASE_URL: z.string().url().default('https://gmail.googleapis.com'),
  MICROSOFT_LOGIN_BASE_URL: z.string().url().default('https://login.microsoftonline.com'),
  MICROSOFT_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com'),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid API environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE && !parsed.data.ALLOW_INSECURE_COOKIES) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ALLOW_PRIVATE_NETWORK_TARGETS) {
    throw new Error('ALLOW_PRIVATE_NETWORK_TARGETS is for tests only and cannot be used in production');
  }
  return parsed.data;
}
