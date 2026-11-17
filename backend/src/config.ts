/**
 * Configuration, read once from the environment and validated. Nothing else in the backend reads process.env.
 * A missing or malformed value stops the server at start-up with a message saying which one.
 */
import { z } from 'zod';

// Load backend/.env if it exists (Node 20.12+). Variables already set in the environment win.
try {
  process.loadEnvFile();
} catch {
  /* no .env file: rely on the environment */
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z
    .string()
    .default('/api/v1')
    .transform((s) => '/' + s.replace(/^\/+|\/+$/g, '')),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  // More origins allowed to make state-changing requests (comma-separated), e.g. a preview deployment.
  EXTRA_ORIGINS: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((o) => o.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().url('EXTRA_ORIGINS must be comma-separated URLs'))),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('Riona <no-reply@riona.local>'),

  TZ: z.string().default('Asia/Kolkata'),
  // Development and tests only: pin the server clock (ISO timestamp) to the demo data's date.
  CLOCK_FIXED_NOW: z
    .string()
    .optional()
    .transform((s) => s || undefined)
    .refine((s) => s === undefined || !Number.isNaN(Date.parse(s)), 'CLOCK_FIXED_NOW must be an ISO timestamp'),

  // Where uploaded files are kept (a local directory; mount a volume in production). Relative to backend/.
  STORAGE_DIR: z.string().default('var/uploads'),
  // Largest upload accepted, in megabytes.
  UPLOAD_MAX_MB: z.coerce.number().positive().max(100).default(10),

  // Single sign-on (OpenID Connect). A provider is offered only when its client id and secret are set.
  // The redirect URI to register with each is APP_ORIGIN + API_PREFIX + /auth/sso/<google|microsoft>/callback.
  GOOGLE_CLIENT_ID: z.string().optional().transform((s) => s || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((s) => s || undefined),
  MICROSOFT_CLIENT_ID: z.string().optional().transform((s) => s || undefined),
  MICROSOFT_CLIENT_SECRET: z.string().optional().transform((s) => s || undefined),
  // A tenant id to accept only your Microsoft Entra directory; "organizations" accepts any work account.
  MICROSOFT_TENANT: z.string().default('organizations'),
  // Development and tests only: point a provider at another OpenID issuer (a local stand-in).
  SSO_GOOGLE_ISSUER: z.string().url().optional(),
  SSO_MICROSOFT_ISSUER: z.string().url().optional(),

  // Client-portal payments. `simulated` confirms at once, as a gateway's webhook would (development and tests);
  // `webhook` waits for the gateway's signed POST /webhooks/payments; `none` turns online payment off.
  PAYMENT_GATEWAY: z.enum(['simulated', 'webhook', 'none']).optional(),
  // Shared secret the gateway signs webhooks with (HMAC-SHA256 of the raw body). Required for `webhook`.
  PAYMENT_WEBHOOK_SECRET: z.string().optional().transform((s) => s || undefined),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid configuration. Check backend/.env (see .env.example):\n${lines}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  host: env.HOST,
  port: env.PORT,
  apiPrefix: env.API_PREFIX,
  logLevel: env.LOG_LEVEL,
  db: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
  session: { secret: env.SESSION_SECRET },
  appOrigin: env.APP_ORIGIN,
  extraOrigins: env.EXTRA_ORIGINS,
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.SMTP_FROM },
  timeZone: env.TZ,
  /** Never used in production, whatever the environment says. */
  fixedNow: env.NODE_ENV === 'production' ? undefined : env.CLOCK_FIXED_NOW,
  storage: { dir: env.STORAGE_DIR, maxBytes: Math.round(env.UPLOAD_MAX_MB * 1024 * 1024) },
  sso: {
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, issuer: (env.NODE_ENV !== 'production' && env.SSO_GOOGLE_ISSUER) || 'https://accounts.google.com' }
      : undefined,
    microsoft: env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, issuer: (env.NODE_ENV !== 'production' && env.SSO_MICROSOFT_ISSUER) || `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/v2.0` }
      : undefined,
  },
  payments: {
    // Never simulated in production; off there until a gateway is configured.
    gateway: env.NODE_ENV === 'production' ? (env.PAYMENT_GATEWAY === 'simulated' ? 'none' : env.PAYMENT_GATEWAY ?? 'none') : env.PAYMENT_GATEWAY ?? 'simulated',
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  },
} as const;

export type Config = typeof config;