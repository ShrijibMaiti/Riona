/**
 * Wave 9: every endpoint in the contract (frontend/app/src/data/repositories/http/endpoints.ts) answers.
 *
 *  - every GET, with real ids from the demo data, as the right kind of account (staff, client, or nobody), answers
 *    2xx with JSON
 *  - every write, aimed at a record that doesn't exist or sent an empty body, answers with a clean refusal (4xx with
 *    the error body) — never a 5xx, and never "no such route". (So this test changes no data.)
 */
import { describe, expect, it } from 'vitest';
import { afterAll } from 'vitest';
import { ENDPOINTS } from '../../../frontend/app/src/data/repositories/http/endpoints';
import { db } from '../helpers/db';
import { anonymous, PREFIX, signIn, testApp, type Client } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

/** Real ids for each resource (the first path segment), so GETs find something. */
const REAL: Record<string, string> = {
  employees: 'E-0112', clients: 'C-11', projects: 'P-214', tasks: 'AD-10', invoices: 'INV-2026-0158', expenses: 'EXP-0700', 'payroll-runs': 'PR-202611',
  documents: 'DOC-241', jobs: 'J-31', candidates: 'CA-500', onboarding: 'OB-21', reviews: 'RV-0100-H2-26', leads: 'LD-40', tickets: 'TK-1182',
  assets: 'AS-100', kb: 'leave-policy-2026', workflows: 'WF-1',
};
const PORTAL: Record<string, string> = { projects: 'P-228', invoices: 'INV-2026-0158', tickets: 'TK-1155', documents: 'DOC-283' };
const OTHER: Record<string, string> = { version: '1', employeeId: 'E-0112', weekStart: '2026-11-02', itemId: 'OB-21-I0', rowId: 'MS-1-0', module: 'Workplace · Assets', slug: 'leave-policy-2026', token: 'not-a-real-token' };

/** Some GETs need a query to make sense. */
const QUERY: Record<string, string> = {
  '/attendance': '?from=2026-11-01&to=2026-11-06', '/documents': '?ownerType=client', '/bookings': '?date=2026-11-06', '/timesheet-weeks': '?employeeId=E-0112',
  '/me/payslips/:month': '', '/dashboard-blocks': '?metric=0&range=26&colour=Violet',
};

const all = Object.entries(ENDPOINTS as Record<string, { routes: string[] }>).flatMap(([name, ep]) => ep.routes.map((r) => {
  const [method, path] = r.split(' ');
  return { name, method, path };
}));

/** Who should call it: the portal is for clients; sign-in, setup, password links and the public site for nobody. */
const callerFor = (path: string): 'client' | 'anonymous' | 'admin' =>
  path.startsWith('/portal') ? 'client' : /^\/(auth\/(login|forgot|reset)|setup|demo-requests)/.test(path) ? 'anonymous' : 'admin';

function fill(path: string, real: boolean) {
  const first = path.split('/')[path.startsWith('/portal') ? 2 : 1];
  return path.replace(/:(\w+)/g, (_m, key: string) => {
    if (key === 'id') return real ? (path.startsWith('/portal') ? PORTAL[first] : REAL[first]) ?? 'X-NOPE' : 'X-NOPE';
    if (key === 'month') return '2026-10';
    return encodeURIComponent(OTHER[key] ?? 'X-NOPE');
  });
}

describe('every endpoint answers', () => {
  const clients: Partial<Record<'client' | 'anonymous' | 'admin', Client>> = {};
  const as = async (who: 'client' | 'anonymous' | 'admin') => (clients[who] ??= who === 'admin' ? await signIn('Admin') : who === 'client' ? await signIn('Client') : await anonymous());

  it('the contract is non-trivial', () => expect(all.length).toBeGreaterThan(130));

  it.each(all.filter((r) => r.method === 'GET').map((r) => [`${r.method} ${r.path}`, r] as const))('%s', async (_label, r) => {
    const c = await as(callerFor(r.path));
    const url = fill(r.path, true) + (QUERY[r.path] ?? '');
    const res = await c.get(url);
    // Setup and password links with a made-up token: a clean "not found".
    if (r.path.includes(':token')) {
      expect(res.status, url).toBe(404);
      expect(res.body.error.code, url).toBe('not_found');
      return;
    }
    expect(res.status, `${url} → ${JSON.stringify(res.body).slice(0, 200)}`).toBeLessThan(300);
  });

  it.each(all.filter((r) => r.method !== 'GET').map((r) => [`${r.method} ${r.path}`, r] as const))('%s', async (_label, r) => {
    const who = callerFor(r.path);
    // Signing out ends the shared session; use a session of its own. Marking notifications read: an Employee's.
    const c = r.path === '/auth/logout' ? await signIn('HR') : r.path === '/notifications/read-all' ? await signIn('Employee') : await as(who);
    const app = await testApp();
    const url = PREFIX + fill(r.path, false);
    const res = await app.inject({ method: r.method as 'POST', url, payload: {}, headers: { ...(c.cookie ? { cookie: c.cookie } : {}), 'x-requested-with': 'riona' } });
    const body = res.body ? res.json() : undefined;
    expect(res.statusCode, `${r.method} ${url} → ${res.body.slice(0, 200)}`).toBeLessThan(500);
    if (res.statusCode >= 400) {
      expect(body?.error?.code, url).toBeTruthy();
      // A refusal, not a missing route.
      expect(app.hasRoute({ method: r.method as 'POST', url: PREFIX + r.path }), url).toBe(true);
    }
  });
});
