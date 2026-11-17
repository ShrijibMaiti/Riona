/**
 * Runs before every test file (vitest setupFiles), before any module reads src/config.ts: points the app at the
 * test database and switches off the mock forwarding, so an unbuilt route is a real 404 in tests.
 *
 * The test database is the dev server's, with `_test` appended to its name (riona → riona_test), unless
 * TEST_DATABASE_URL says otherwise. Development data is never touched.
 */
try {
  process.loadEnvFile();
} catch {
  /* no .env: rely on the environment */
}

export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://riona:riona@localhost:5433/riona');
  if (!url.pathname.endsWith('_test')) url.pathname += '_test';
  return url.toString();
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret-0123';
// The payment gateway's webhook signature key (tests sign their own webhooks with it).
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-test-webhook-secret';
process.env.PAYMENT_GATEWAY ??= 'simulated';
// A stand-in Google (test/security/sso.test.ts serves it); Microsoft stays unconfigured.
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-secret';
process.env.SSO_GOOGLE_ISSUER ??= 'http://127.0.0.1:47811';
process.env.MICROSOFT_CLIENT_ID = '';
process.env.APP_ORIGIN ??= 'http://localhost:5173';
