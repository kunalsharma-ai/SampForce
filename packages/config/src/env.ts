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
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /** Escape hatch for running the production image over plain http on localhost only. */
  ALLOW_INSECURE_COOKIES: bool.default('false'),
  /** 32-byte key (base64 or hex) for encrypting webhook secrets and mailbox tokens. Required in production. */
  ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Public URL of the web app, used for OAuth redirect URIs and links in notifications. */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Runs the background worker inside the API process (development and e2e only). */
  RUN_WORKER_IN_PROCESS: bool.default('false'),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),
  /** Port for Prometheus metrics and the worker's health check, on a listener separate from the public API. Unset = off. */
  METRICS_PORT: z.coerce.number().int().positive().optional(),
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
  /** Claude API key for the AI gateway. Empty or missing means AI features say they are not configured. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v || undefined),
  /** Claude API endpoint (tests point this at a local fixture). Deliberately not ANTHROPIC_BASE_URL. */
  AI_API_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(90_000),
  /** Ask the Claude API to re-run a declined request on its recommended fallback model. */
  AI_SERVER_FALLBACKS: bool.default('true'),
  /** Model calls one user may make per minute. */
  AI_USER_CALLS_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(30),

  // ───── Billing (Phase 6). With no provider keys, checkout says it is not configured. ─────
  STRIPE_SECRET_KEY: z.string().optional().transform((v) => v || undefined),
  STRIPE_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  STRIPE_API_BASE_URL: z.string().url().default('https://api.stripe.com'),
  /** Ask Stripe Tax to calculate tax at checkout. Needs Stripe Tax set up on the account. */
  STRIPE_AUTOMATIC_TAX: bool.default('false'),
  /** Price ids per plan and interval, e.g. `launch:MONTH=price_123,launch:YEAR=price_456`. Unlisted plans cannot be bought. */
  STRIPE_PRICES: z.string().default(''),
  RAZORPAY_KEY_ID: z.string().optional().transform((v) => v || undefined),
  RAZORPAY_KEY_SECRET: z.string().optional().transform((v) => v || undefined),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  RAZORPAY_API_BASE_URL: z.string().url().default('https://api.razorpay.com'),
  /** Razorpay plan ids per plan and interval, same format as STRIPE_PRICES. */
  RAZORPAY_PLANS: z.string().default(''),
  /** Days a past-due workspace keeps its paid allowances before falling back to Free. */
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(14),
  TRIAL_DAYS: z.coerce.number().int().min(1).max(60).default(14),
  /** Set true only once the rate card is approved for publication; until then the site labels prices a preview. */
  PRICING_PUBLISHED: bool.default('false'),
  /** Shown for Enterprise Plus and custom quotes. Unset means no contact address is shown. */
  SALES_CONTACT_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),
  /** Signs operator-console sessions. Unset disables the operator console entirely. */
  OPERATOR_JWT_SECRET: z.string().min(32).optional().or(z.literal('').transform(() => undefined)),
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
  const d = parsed.data;
  if (d.STRIPE_SECRET_KEY && !d.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set');
  if (!!d.RAZORPAY_KEY_ID !== !!d.RAZORPAY_KEY_SECRET) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together');
  if (d.RAZORPAY_KEY_ID && !d.RAZORPAY_WEBHOOK_SECRET) throw new Error('RAZORPAY_WEBHOOK_SECRET is required when Razorpay keys are set');
  if (d.OPERATOR_JWT_SECRET && d.OPERATOR_JWT_SECRET === d.JWT_ACCESS_SECRET) throw new Error('OPERATOR_JWT_SECRET must differ from JWT_ACCESS_SECRET');
  return d;
}
