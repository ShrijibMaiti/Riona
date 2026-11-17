/**
 * Approval SLAs. Every quarter-hour, each pending request whose current step has been waiting longer than its SLA
 * (the workflow's Approver step, e.g. "48h" or "3d"):
 *   - is approved automatically, if the workflow says "When the SLA passes: approve automatically" — recorded as
 *     that step's decision, with the reason, by the system; the request moves on exactly as if the approver had
 *     approved it (next approver told, or the outcome applied and the requester told)
 *   - otherwise its approver is reminded, once per step
 * A step's wait starts when it became current: the request's creation for the first, the previous decision after.
 */
import { db } from '../../db/client';
import { SYSTEM_ACTOR, withTransaction } from '../../db/tx';
import { now } from '../../lib/dates';
import { recordDecision } from './engine';
import { ownedTypes } from './outcomes';
import type { PlanStep } from './resolvers';

/** "48h" → ms; "3d" → ms; anything else → null (no SLA). */
export function slaMs(sla: string | undefined): number | null {
  const m = sla?.trim().match(/^(\d+(?:\.\d+)?)\s*([hd])$/i);
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === 'd' ? 24 : 1) * 3600_000;
}

/** Runs one pass. Returns how many requests were approved automatically and how many approvers reminded. */
export async function runApprovalTimeouts(at: Date = now()): Promise<{ approved: number; reminded: number }> {
  const pending = await db.selectFrom('approvals').select(['id', 'current', 'plan', 'createdAt', 'remindedStep'])
    .where('status', '=', 'Pending').where('type', 'in', ownedTypes()).execute();
  let approved = 0, reminded = 0;
  for (const p of pending) {
    const step = (p.plan as unknown as PlanStep[])[p.current - 1];
    const limit = slaMs(step?.sla);
    if (!step || limit === null) continue;
    if (step.onTimeout !== 'approve' && p.remindedStep === p.current) continue;
    // When this step became current.
    const prev = p.current > 1
      ? (await db.selectFrom('approvalSteps').select('at').where('approvalId', '=', p.id).where('step', '=', p.current - 1).executeTakeFirst())?.at
      : p.createdAt;
    if (!prev || at.getTime() - Date.parse(prev) < limit) continue;

    await withTransaction({ ...SYSTEM_ACTOR, name: 'Riona' }, async (tx) => {
      // Re-read under a lock: someone may have decided in the meantime.
      const row = await tx.db.selectFrom('approvals').selectAll().where('id', '=', p.id).forUpdate().executeTakeFirst();
      if (!row || row.status !== 'Pending' || row.current !== p.current) return;
      if (step.onTimeout === 'approve') {
        await recordDecision(tx, row, true, `Approved automatically: no decision within ${step.sla}.`, { employeeId: null, name: 'Riona' });
        approved++;
      } else {
        await tx.db.updateTable('approvals').set({ remindedStep: row.current }).where('id', '=', row.id).execute();
        await tx.notify({ recipientIds: [step.approverId], kind: 'Approval', text: `Reminder: a ${row.type.toLowerCase()} request has waited on you for more than ${step.sla}.`, href: '/app/approvals', approvalId: row.id, actorId: row.requesterId });
        await tx.audit('Reminded', 'Approval', row.id, [{ field: 'approver', before: null, after: step.approverId }]);
        reminded++;
      }
    });
  }
  return { approved, reminded };
}
