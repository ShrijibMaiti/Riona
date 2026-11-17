/**
 * Wave 9: approval SLAs (engines/approvals/timeouts.job.ts). Past its SLA a step's approver is reminded, once; or,
 * where the workflow says "approve automatically", the step is approved by the system with the reason, and the
 * request moves on exactly as if the approver had approved it. Nothing happens before the SLA, or to a request
 * someone decided in the meantime. The demo's workflows remind (they set SLAs but never "approve automatically").
 */
import { afterAll, describe, expect, it } from 'vitest';
import { runApprovalTimeouts, slaMs } from '../../src/engines/approvals/timeouts.job';
import { db } from '../helpers/db';
import { signIn, testApp } from '../helpers/session';

afterAll(async () => {
  await (await testApp()).close();
  await db.destroy();
});

let week = 0;
/** Two fresh working days in mid-2027, clear of every other test's leave. */
const apply = async () => {
  const start = new Date(Date.UTC(2027, 5, 7 + week++ * 7)); // Mondays from 7 June 2027
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const res = await (await signIn('Employee')).post('/leave-requests', { type: 'CL', from: iso(start), to: iso(new Date(start.getTime() + 864e5)), reason: 'Family visit', days: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; approvalId: string };
};
const hoursLater = (h: number) => new Date(Date.now() + h * 3600_000);
const approval = (id: string) => db.selectFrom('approvals').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

/** WF-1 (leave) with every Approver step given an SLA and a timeout rule. Returns a restore function. */
async function setLeaveSla(sla: string, onTimeout: 'remind' | 'approve') {
  const admin = await signIn('Admin');
  const wf = (await admin.get('/workflows/WF-1')).body;
  const changed = { ...wf, nodes: wf.nodes.map((n: { kind: string; config: Record<string, string> }) => (n.kind === 'Approver' ? { ...n, config: { ...n.config, sla, onTimeout } } : n)) };
  expect((await admin.put('/workflows/WF-1', changed)).status).toBe(200);
  return async () => expect((await admin.put('/workflows/WF-1', wf)).status).toBe(200);
}

describe('approval timeouts', () => {
  it('reads SLAs in hours and days', () => {
    expect(slaMs('48h')).toBe(48 * 3600_000);
    expect(slaMs('3d')).toBe(72 * 3600_000);
    expect(slaMs('')).toBeNull();
    expect(slaMs('soon')).toBeNull();
  });

  it('past the SLA the approver is reminded once; before it, nothing', async () => {
    const restore = await setLeaveSla('48h', 'remind');
    try {
      const leave = await apply();
      const before = await approval(leave.approvalId);
      const step = (before.plan as { approverId: string; sla?: string }[])[0];
      expect(step.sla).toBe('48h');
      const notes = async () => Number((await db.selectFrom('outbox').select(db.fn.countAll().as('n')).where('topic', '=', 'notify')
        .where((eb) => eb(eb.ref('payload'), '@>', JSON.stringify({ approvalId: leave.approvalId, recipientIds: [step.approverId] }) as never)).executeTakeFirstOrThrow()).n);
      const start = await notes();

      expect((await runApprovalTimeouts(hoursLater(47))).reminded).toBe(0);
      const first = await runApprovalTimeouts(hoursLater(49));
      expect(first.reminded).toBeGreaterThanOrEqual(1);
      expect(await notes()).toBe(start + 1);
      expect((await approval(leave.approvalId)).remindedStep).toBe(1);
      await runApprovalTimeouts(hoursLater(60)); // not again
      expect(await notes()).toBe(start + 1);
      expect((await approval(leave.approvalId)).status).toBe('Pending');
    } finally {
      await restore();
    }
  });

  it('where the workflow says so, the step is approved automatically and the request moves on', async () => {
    const restore = await setLeaveSla('24h', 'approve');
    try {
      const leave = await apply();
      const plan = (await approval(leave.approvalId)).plan as { onTimeout?: string }[];
      expect(plan.every((s) => s.onTimeout === 'approve')).toBe(true);
      let at = 25;
      for (let i = 0; i < plan.length; i++) {
        await runApprovalTimeouts(hoursLater(at));
        at += 25; // the next step's clock starts at the previous decision (now), so move well past it
      }
      // Each step decided by the system, with the reason; the leave itself approved.
      const a = await approval(leave.approvalId);
      const steps = await db.selectFrom('approvalSteps').selectAll().where('approvalId', '=', leave.approvalId).orderBy('step').execute();
      expect(a.status).toBe('Approved');
      expect(steps).toHaveLength(plan.length);
      expect(steps.every((s) => s.decision === 'Approved' && s.comment === 'Approved automatically: no decision within 24h.')).toBe(true);
      const l = await db.selectFrom('leaveRequests').select('status').where('id', '=', leave.id).executeTakeFirstOrThrow();
      expect(l.status).toBe('Approved');
      const audit = await db.selectFrom('auditLog').select(['actor', 'action']).where('entityId', '=', leave.id).where('action', '=', 'Approved').executeTakeFirst();
      expect(audit?.actor).toBe('Riona');
    } finally {
      await restore();
    }
  });

  it('a request decided in the meantime, or still inside its SLA, is left alone', async () => {
    const restore = await setLeaveSla('24h', 'approve');
    let leave: { id: string; approvalId: string };
    try {
      leave = await apply();
    } finally {
      await restore();
    }
    // Rejected by the manager before the job runs.
    const a = await approval(leave.approvalId);
    const approver = (a.plan as { approverId: string }[])[0].approverId;
    const u = await db.selectFrom('users').select('email').where('employeeId', '=', approver).executeTakeFirstOrThrow();
    expect((await (await signIn(u.email)).post(`/approvals/${leave.approvalId}/decision`, { approve: false, comment: 'Clashes with the release' })).status).toBe(200);
    await runApprovalTimeouts(hoursLater(100));
    expect((await approval(leave.approvalId)).status).toBe('Rejected');
    // Under the demo's own leave workflow (48h, remind), nothing happens before the SLA passes.
    const plain = await apply();
    expect(((await approval(plain.approvalId)).plan as { sla?: string; onTimeout?: string }[])[0]).toMatchObject({ sla: '48h' });
    await runApprovalTimeouts(hoursLater(24));
    const p = await approval(plain.approvalId);
    expect([p.status, p.remindedStep]).toEqual(['Pending', null]);
  });
});
