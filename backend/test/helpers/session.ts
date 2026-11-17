/**
 * Signed-in requests against an in-process app (no port): `const hr = await signIn('HR')`, then `hr.get('/me')`,
 * `hr.post('/auth/logout')`. Mutations carry the CSRF header like the frontend does.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../db/seed/import-fixture';

export const PREFIX = '/api/v1';
export const ACCOUNTS = DEMO_ACCOUNTS;
export { DEMO_PASSWORD };

let app: FastifyInstance | null = null;
export async function testApp() {
  app ??= await buildApp();
  await app.ready();
  return app;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Res = { status: number; body: any; headers: Record<string, unknown> };

export function clientFor(a: FastifyInstance, cookie: string | null) {
  const call = async (method: Method, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const res = await a.inject({
      method, url: PREFIX + url, payload: body as object | undefined,
      headers: { ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : { 'x-requested-with': 'riona' }), ...headers },
    });
    return { status: res.statusCode, body: res.body ? res.json() : undefined, headers: res.headers };
  };
  return {
    cookie,
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', url, body, headers),
    put: (url: string, body: unknown) => call('PUT', url, body),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
  };
}
export type Client = ReturnType<typeof clientFor>;

export const anonymous = async () => clientFor(await testApp(), null);

/** The session cookie from a response's Set-Cookie, as a Cookie header value. */
export function sessionCookie(setCookie: unknown): string | null {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [String(setCookie)] : [];
  const c = all.find((x) => x.startsWith('riona_session=') && !x.startsWith('riona_session=;'));
  return c ? c.split(';')[0] : null;
}

/** Sign in as a demo role ('Admin', 'HR', 'Manager', 'Employee') or any seeded email. */
export async function signIn(who: keyof typeof ACCOUNTS | string, password = DEMO_PASSWORD) {
  const a = await testApp();
  const email = who in ACCOUNTS ? ACCOUNTS[who as keyof typeof ACCOUNTS] : who;
  const res = await a.inject({ method: 'POST', url: PREFIX + '/auth/login', payload: { email, password }, headers: { 'x-requested-with': 'riona' } });
  if (res.statusCode !== 200) throw new Error(`Sign-in failed for ${email}: ${res.statusCode} ${res.body}`);
  return clientFor(a, sessionCookie(res.headers['set-cookie']));
}
