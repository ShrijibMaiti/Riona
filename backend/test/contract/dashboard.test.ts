/**
 * Wave 9: GET /dashboard-facts and /dashboard-blocks answer exactly what the browser used to compute itself: for
 * each role, the same figures, attention lists, dashboard list and blocks as running the selectors over the API
 * responses that role gets (the old load-every-collection useFacts), in one request.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { dashboardFacts } from '../../../frontend/app/src/data/selectors/dashboard';
import { buildBlocks } from '../../../frontend/app/src/data/selectors/blocks';
import type { FactsInput } from '../../../frontend/app/src/data/selectors/facts';
import { db } from '../helpers/db';
import { signIn, testApp, type Client } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

/** What the browser's useFacts loaded, call by call; a refused list was empty. */
async function browserInput(c: Client): Promise<FactsInput> {
  const me = (await c.get('/me')).body;
  const t = me.today;
  const get = async (path: string, items = false) => {
    const r = await c.get(path);
    if (r.status === 403 || r.status === 404) return [];
    expect(r.status, path).toBe(200);
    return items ? r.body.items : r.body;
  };
  const runs = await get('/payroll-runs');
  return {
    today: t, now: me.now, meId: me.employee.id,
    employees: await get('/employees?pageSize=1000', true),
    attendance: await get(`/attendance?from=${me.historyFrom}&to=${t}`),
    leave: await get('/leave-requests'), leaveTypes: await get('/leave-types'), holidays: await get('/holidays'),
    approvals: await get('/approvals'), entries: await get('/timesheet-entries'),
    invoices: await get('/invoices?pageSize=1000', true), expenses: await get('/expenses?pageSize=1000', true),
    clients: await get('/clients'), projects: await get('/projects?pageSize=1000', true), tasks: await get('/tasks'),
    salaryEvents: await get('/salary-events'), leads: await get('/leads'), contracts: await get('/contracts'), tickets: await get('/tickets'),
    assets: await get('/assets'), inventory: await get('/inventory'), bookings: await get('/bookings?date=' + t), visitors: await get('/visitors'),
    users: await get('/users'), workflows: await get('/workflows'), audit: await get('/audit?pageSize=500', true), systemJobs: await get('/system-jobs'),
    payrollRuns: [...runs].reverse(), jobs: await get('/jobs'), candidates: await get('/candidates'), onboarding: await get('/onboarding'),
    reviews: await get('/reviews'), certifications: await get('/training/certifications'), announcements: await get('/announcements'),
    kb: await get('/kb'), budgets: await get('/budgets'),
  };
}

const ROLES = ['Admin', 'HR', 'Manager', 'Employee'] as const;

describe('dashboard facts', () => {
  it.each(ROLES)('%s: the server’s answer equals the browser’s old computation', async (role) => {
    const c = await signIn(role);
    const input = await browserInput(c);
    const res = await c.get('/dashboard-facts?role=' + role);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(JSON.parse(JSON.stringify(dashboardFacts(input, role, input.now!))));
    expect(Object.keys(res.body.attention).length).toBeGreaterThan(5);
  });

  it.each(ROLES)('%s: blocks, for every metric, range and colour tried', async (role) => {
    const c = await signIn(role);
    const input = await browserInput(c);
    for (const [metric, range, colour] of [[0, 26, 'Violet'], [1, 13, 'Ember'], [2, 52, 'Mono']] as const) {
      const res = await c.get(`/dashboard-blocks?metric=${metric}&range=${range}&colour=${colour}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(JSON.parse(JSON.stringify(buildBlocks({ ...input, role }, metric, range, colour))));
    }
  });

  it('is for one’s own role only, and not for client accounts', async () => {
    expect((await (await signIn('Employee')).get('/dashboard-facts?role=Admin')).status).toBe(403);
    expect((await (await signIn('Client')).get('/dashboard-facts')).status).toBe(403);
    expect((await (await signIn('Admin')).get('/dashboard-blocks?range=7')).status).toBe(422);
  });

  it('is one request instead of thirty-odd', async () => {
    const c = await signIn('Admin');
    const t0 = Date.now();
    await c.get('/dashboard-facts');
    const one = Date.now() - t0;
    expect(one).toBeLessThan(5000);
  });
});
