/**
 * Wave 1: who is asking, and what they may do.
 *  - the actor comes from the session cookie only; GET /me reports it with the server's clock
 *  - sign-in failures, lockout, sign-out, expiry and deactivation all end in 401
 *  - state-changing requests need the CSRF header and a same-origin Origin
 *  - the permission matrix and the reporting-tree scopes decide what each role reaches
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/http/plugins/session';
import { hashToken } from '../../src/http/plugins/session';
import { MATRIX, atLeast, levelOf } from '../../src/auth/rbac/permissions';
import { reportsOf, scopeOf, visibleEmployeeIds } from '../../src/auth/rbac/scope';
import { authorize, authorizeRecord } from '../../src/auth/rbac/authorize';
import { ApiError } from '../../src/lib/errors';
import { count, db, sql } from '../helpers/db';
import { ACCOUNTS, anonymous, clientFor, DEMO_PASSWORD, PREFIX, sessionCookie, signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

const actor = (role: Actor['role'], employeeId: string | null): Actor => ({ userId: 'U', employeeId, clientId: null, name: 'Test', role, sessionId: 'S', ip: '', requestId: '' });
const statusOf = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};

describe('GET /me', () => {
  it('answers 401 without a session, with the frontend’s copy', async () => {
    const res = await (await anonymous()).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'unauthenticated', message: 'Your session has ended. Sign in again.' });
  });

  it.each([
    ['Admin', 'E-0100'], ['HR', 'E-0107'], ['Manager', 'E-0104'], ['Employee', 'E-0112'],
  ] as const)('returns the %s’s own record, role and the server clock', async (role, id) => {
    const res = await (await signIn(role)).get('/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role, orgName: 'Kestrel Digital', today: '2026-11-06', now: '2026-11-06T11:00:00+05:30', timeZone: 'Asia/Kolkata', historyFrom: '2026-05-01' });
    expect(res.body.employee).toMatchObject({ id, email: ACCOUNTS[role] });
    expect(res.body.employee.bank.accountLast4).toHaveLength(4);
  });
});

describe('sign-in', () => {
  it('sets an HttpOnly, SameSite=Lax cookie and stores only the token’s hash', async () => {
    const a = await testApp();
    const res = await a.inject({ method: 'POST', url: PREFIX + '/auth/login', payload: { email: ACCOUNTS.HR, password: DEMO_PASSWORD }, headers: { 'x-requested-with': 'riona' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, role: 'HR' });
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    const token = decodeURIComponent(sessionCookie(res.headers['set-cookie'])!.split('=')[1]);
    expect(await count('sessions', `id = '${token}'`)).toBe(0);
    expect(await count('sessions', `id = '${hashToken(token)}'`)).toBe(1);
  });

  it('accepts the email in any case', async () => {
    expect((await signIn(ACCOUNTS.Employee.toUpperCase())).cookie).toBeTruthy();
  });

  it('gives the same answer for a wrong password, an unknown email and an invited account', async () => {
    const anon = await anonymous();
    for (const [email, password] of [[ACCOUNTS.Admin, 'wrong-password'], ['nobody@kestrel.digital', DEMO_PASSWORD], ['kunal.grover@kestrel.digital', DEMO_PASSWORD]]) {
      const res = await anon.post('/auth/login', { email, password });
      expect(res.status, email).toBe(401);
      expect(res.body.error.message).toBe('That email and password don’t match.');
    }
  });

  it('validates the body as UI copy', async () => {
    const res = await (await anonymous()).post('/auth/login', { email: 'not-an-email', password: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Enter a valid work email.');
  });

  it('locks an account for 15 minutes after five failures, and audits the lock', async () => {
    const email = 'omar.sheikh@kestrel.digital';
    const anon = await anonymous();
    for (let i = 0; i < 5; i++) expect((await anon.post('/auth/login', { email, password: 'nope-nope' })).status).toBe(401);
    const locked = await anon.post('/auth/login', { email, password: DEMO_PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toBe('Too many attempts. Try again in 15 minutes.');
    const user = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    expect(await count('audit_log', `action = 'Locked' AND entity_id = '${user.id}'`)).toBe(1);
    await db.updateTable('users').set({ lockedUntil: null }).where('id', '=', user.id).execute();
    expect((await anon.post('/auth/login', { email, password: DEMO_PASSWORD })).status).toBe(200);
  });
});

describe('the session ends', () => {
  it('on sign-out: 204, the cookie is cleared and the old cookie no longer works', async () => {
    const c = await signIn('Manager');
    const out = await c.post('/auth/logout');
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/riona_session=;/);
    expect((await c.get('/me')).status).toBe(401);
    expect((await (await anonymous()).post('/auth/logout')).status).toBe(204); // idempotent
  });

  it('when it expires, or the account is deactivated', async () => {
    const c = await signIn('Employee');
    const id = hashToken(decodeURIComponent(c.cookie!.split('=')[1]));
    await db.updateTable('sessions').set({ expiresAt: new Date(Date.now() - 1000) }).where('id', '=', id).execute();
    expect((await c.get('/me')).status).toBe(401);

    const d = await signIn('Employee');
    await db.updateTable('users').set({ status: 'Deactivated' }).where('email', '=', ACCOUNTS.Employee).execute();
    try {
      expect((await d.get('/me')).status).toBe(401);
    } finally {
      await db.updateTable('users').set({ status: 'Active' }).where('email', '=', ACCOUNTS.Employee).execute();
    }
  });

  it('ignores a forged cookie', async () => {
    const forged = clientFor(await testApp(), 'riona_session=' + 'A'.repeat(43));
    expect((await forged.get('/me')).status).toBe(401);
  });
});

describe('CSRF', () => {
  it('blocks a state-changing request without X-Requested-With', async () => {
    const a = await testApp();
    const res = await a.inject({ method: 'POST', url: PREFIX + '/auth/login', payload: { email: ACCOUNTS.Admin, password: DEMO_PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
  });

  it('blocks a foreign Origin, allows the app’s own and the proxied host', async () => {
    const anon = await anonymous();
    const body = { email: ACCOUNTS.Admin, password: DEMO_PASSWORD };
    expect((await anon.post('/auth/login', body, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await anon.post('/auth/login', body, { origin: 'http://localhost:5173' })).status).toBe(200);
    expect((await anon.post('/auth/login', body, { origin: 'http://localhost:4173', 'x-forwarded-host': 'localhost:4173' })).status).toBe(200);
  });

  it('lets GET through without the header', async () => {
    expect((await (await signIn('Admin')).get('/me')).status).toBe(200);
  });
});

describe('organisation setup links', () => {
  it('checks a link: valid, expired (410), unknown (404)', async () => {
    const anon = await anonymous();
    expect((await anon.get('/setup/demo-token')).body).toEqual({ orgName: 'Kestrel Digital', email: 'owner@kestrel.digital' });
    expect((await anon.get('/setup/expired-link')).status).toBe(410);
    expect((await anon.get('/setup/no-such-link')).status).toBe(404);
  });

  it('creates the first Admin once, signs them in, and audits it', async () => {
    const anon = await anonymous();
    const input = { orgName: 'Kestrel Digital', legalName: 'Kestrel Digital Pvt Ltd', state: 'Karnataka', gstin: '', adminName: 'Owner Person', password: 'short', modules: ['People'] };
    expect((await anon.post('/setup/demo-token', input)).status).toBe(422);
    const res = await anon.post('/setup/demo-token', { ...input, password: 'a-long-enough-password' });
    expect(res.status).toBe(200);
    const owner = clientFor(await testApp(), sessionCookie(res.headers['set-cookie']));
    const me = await owner.get('/me');
    expect(me.body).toMatchObject({ role: 'Admin', employee: { name: 'Owner Person', email: 'owner@kestrel.digital' } });
    expect(await count('audit_log', `entity = 'Organisation' AND action = 'Set up'`)).toBe(1);
    expect((await anon.post('/setup/demo-token', { ...input, password: 'a-long-enough-password' })).status).toBe(410);
  });
});

describe('password reset request', () => {
  it('answers the same for any email; queues an email only for a real, active account', async () => {
    const anon = await anonymous();
    const before = await count('outbox', `topic = 'email'`);
    expect((await anon.post('/auth/forgot', { email: 'nobody@kestrel.digital' })).body).toEqual({ ok: true });
    expect(await count('outbox', `topic = 'email'`)).toBe(before);
    expect((await anon.post('/auth/forgot', { email: ACCOUNTS.Manager })).body).toEqual({ ok: true });
    expect(await count('outbox', `topic = 'email' AND payload->>'to' = '${ACCOUNTS.Manager}'`)).toBe(1);
    expect(await count('password_resets', `user_id = (SELECT id FROM users WHERE email = '${ACCOUNTS.Manager}')`)).toBe(1);
  });
});

describe('permission matrix', () => {
  it('orders levels none < view < edit < approve', () => {
    expect(atLeast('approve', 'edit')).toBe(true);
    expect(atLeast('view', 'edit')).toBe(false);
    expect(atLeast('none', 'view')).toBe(false);
  });

  it('keeps salary and payroll away from managers and employees, and admin to Admin', () => {
    expect([levelOf('Manager', 'salary'), levelOf('Employee', 'salary'), levelOf('Employee', 'payroll')]).toEqual(['none', 'none', 'none']);
    expect(levelOf('HR', 'salary')).toBe('edit');
    expect((['HR', 'Manager', 'Employee'] as const).map((r) => MATRIX[r].admin)).toEqual(['none', 'none', 'none']);
    expect(levelOf('Client', 'directory')).toBe('none');
  });

  it('authorize: 401 without an actor, 403 below the level, passes at or above it', async () => {
    expect(await statusOf(() => authorize(null, 'leave', 'view'))).toBe(401);
    expect(await statusOf(() => authorize(actor('Employee', 'E-0112'), 'payroll', 'view'))).toBe(403);
    expect(await statusOf(() => authorize(actor('Manager', 'E-0104'), 'leave', 'approve'))).toBe(200);
  });
});

describe('scopes over the reporting tree', () => {
  it('own, team and all', async () => {
    expect(scopeOf('Employee', 'leave')).toBe('own');
    expect(scopeOf('Manager', 'leave')).toBe('team');
    expect(scopeOf('HR', 'leave')).toBe('all');
    expect(await visibleEmployeeIds(db, actor('Admin', 'E-0100'), 'leave')).toBeNull();
    expect(await visibleEmployeeIds(db, actor('Employee', 'E-0112'), 'leave')).toEqual(['E-0112']);
  });

  it('a manager’s team is everyone below them, at any depth, and nobody else', async () => {
    const tree = (await sql<{ id: string }>`
      WITH RECURSIVE t AS (SELECT id FROM employees WHERE manager_id = 'E-0100' UNION SELECT e.id FROM employees e JOIN t ON e.manager_id = t.id)
      SELECT id FROM t`.execute(db)).rows.map((r) => r.id).sort();
    expect((await reportsOf(db, 'E-0100')).sort()).toEqual(tree);
    // Kabir (E-0118) reports to Dipak (E-0100), so Kabir's reports (Aarav, E-0112) are in Dipak's tree.
    expect(tree).toEqual(expect.arrayContaining(['E-0118', 'E-0112']));
    const vikram = await visibleEmployeeIds(db, actor('Manager', 'E-0104'), 'leave');
    expect(vikram).toEqual(expect.arrayContaining(['E-0104', 'E-0127', 'E-0136']));
    expect(vikram).not.toContain('E-0112');
  });

  it('authorizeRecord: a record outside the scope is a 404, not a 403', async () => {
    const vikram = actor('Manager', 'E-0104');
    expect(await statusOf(authorizeRecord(db, vikram, 'leave', 'approve', 'E-0127'))).toBe(200);
    expect(await statusOf(authorizeRecord(db, vikram, 'leave', 'approve', 'E-0112'))).toBe(404);
    expect(await statusOf(authorizeRecord(db, actor('Employee', 'E-0112'), 'leave', 'view', 'E-0121'))).toBe(404);
    expect(await statusOf(authorizeRecord(db, actor('Employee', 'E-0112'), 'payroll', 'view', 'E-0112'))).toBe(403);
  });
});
