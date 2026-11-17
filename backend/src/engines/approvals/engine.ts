/**
 * The approval engine. Leave, timesheet weeks, regularisations and profile changes (and, from Wave 6, expenses and
 * invoices) all go through it:
 *
 *   openApproval  inside the request's own transaction: resolve the chain, store it, tell the first approver
 *   decide        only the current approver; a rejection needs a reason; the final decision applies the outcome
 *   approveMany   the bulk "Approve selected" in the queue; each one on its own, skipping any that changed
 *   withdraw      the requester recalled or cancelled it before a decision
 *   listApprovals each with its source record embedded, as the queue and dashboards read them
 *
 * A request = its source record + an approval row with its resolved chain (`plan`) + append-only decision steps.
 * Every decision is audited and notified.
 */
import type { Approval, ApprovalStep, ApprovalWithSource } from '@riona/shared';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { Workflow } from '@riona/shared';
import { db } from '../../db/client';
import type { Approvals, DB } from '../../db/schema';
import { withTransaction, type Tx } from '../../db/tx';
import type { Actor } from '../../http/plugins/session';
import { can } from '../../auth/rbac/authorize';
import { reportsOf } from '../../auth/rbac/scope';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { today } from '../../lib/dates';
import { handlerFor, ownedTypes } from './outcomes';
import { resolveChain, type ApprovalType, type Facts, type PlanStep } from './resolvers';

type Q = Kysely<DB> | Transaction<DB>;
type Row = Selectable<Approvals>;

export type OpenInput = {
  type: ApprovalType;
  sourceId: string;
  requesterId: string;
  facts?: Facts;
  projectManagerId?: string | null;
  accountOwnerId?: string | null;
  /** No approver on the workflow's path means approved (instead of an Admin deciding). */
  autoApproveWhenNoApprover?: boolean;
};

/** The module's active workflow, at its current version. */
async function activeWorkflow(q: Q, type: ApprovalType) {
  const wf = await q.selectFrom('workflows').select(['id', 'currentVersion']).where('module', '=', type).where('status', '=', 'Active').executeTakeFirst();
  if (!wf) return null;
  const v = await q.selectFrom('workflowVersions').select('definition').where('workflowId', '=', wf.id).where('version', '=', wf.currentVersion).executeTakeFirstOrThrow();
  return { id: wf.id, version: wf.currentVersion, definition: v.definition as unknown as Pick<Workflow, 'nodes' | 'edges'> };
}

/**
 * Opens an approval for a new request, in the caller's transaction. Returns its id and status: 'Pending' normally,
 * 'Rejected' when the workflow refuses it outright (a reject outcome), 'Approved' when nobody at all can approve it.
 */
export async function openApproval(tx: Tx, input: OpenInput): Promise<{ id: string; status: 'Pending' | 'Approved' | 'Rejected' }> {
  const wf = await activeWorkflow(tx.db, input.type);
  const res = await resolveChain(tx.db, wf?.definition ?? null, {
    type: input.type, requesterId: input.requesterId, facts: input.facts ?? {}, projectManagerId: input.projectManagerId, accountOwnerId: input.accountOwnerId,
    noFallback: input.autoApproveWhenNoApprover,
  });
  const id = newId('AP');
  const status = res.rejected ? 'Rejected' : res.steps.length ? 'Pending' : 'Approved';
  await tx.db.insertInto('approvals').values({
    id, type: input.type, sourceId: input.sourceId, requesterId: input.requesterId, submitted: today(), status, current: 1,
    plan: JSON.stringify(res.steps), notify: JSON.stringify(res.notify), workflowId: wf?.id ?? null, workflowVersion: wf?.version ?? null,
    decidedAt: status === 'Pending' ? null : new Date(),
  }).execute();
  if (status === 'Pending') {
    await tx.notify({ recipientIds: [res.steps[0].approverId], kind: 'Approval', text: '', href: '/app/approvals', approvalId: id, actorId: input.requesterId });
  } else {
    // Decided as it was made: apply the outcome now and tell the requester why.
    await handlerFor(input.type).apply(tx, { id, type: input.type, sourceId: input.sourceId, requesterId: input.requesterId, status }, res.reason ?? null);
    await tx.audit(status, `${input.type} request`, input.sourceId, [{ field: 'status', before: null, after: status + (res.reason ? ` · ${res.reason}` : ' · no approver') }]);
  }
  return { id, status };
}

/** The chain as the API shows it: step 0 is the requester, then each approver with their decision. */
async function toApprovals(q: Q, rows: Row[]): Promise<Approval[]> {
  if (!rows.length) return [];
  const steps = await q.selectFrom('approvalSteps').selectAll().where('approvalId', 'in', rows.map((r) => r.id)).execute();
  return rows.map((r) => {
    const plan = r.plan as unknown as PlanStep[];
    const chain: ApprovalStep[] = [
      { approverId: r.requesterId, role: 'Requester', decision: 'Approved', at: r.createdAt, comment: null },
      ...plan.map((p, i) => {
        const s = steps.find((x) => x.approvalId === r.id && x.step === i + 1);
        return { approverId: p.approverId, role: p.role, decision: (s?.decision ?? null) as ApprovalStep['decision'], at: s?.at ?? null, comment: s?.comment ?? null };
      }),
    ];
    return { id: r.id, type: r.type as Approval['type'], sourceId: r.sourceId, requesterId: r.requesterId, submitted: r.submitted, status: r.status as Approval['status'], chain, current: r.current };
  });
}

/** Approvals with their source records embedded; one whose record can't be found is left out. */
export async function withSources(q: Q, approvals: Approval[]): Promise<ApprovalWithSource[]> {
  const byType = new Map<string, Approval[]>();
  for (const a of approvals) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  const sources = new Map<string, ApprovalWithSource['source']>();
  for (const [type, list] of byType) {
    const found = await handlerFor(type).loadSources(q, list.map((a) => a.sourceId));
    for (const a of list) {
      const s = found.get(a.sourceId);
      if (s) sources.set(a.id, s);
    }
  }
  return approvals.filter((a) => sources.has(a.id)).map((a) => ({ ...a, source: sources.get(a.id)! }));
}

export type ApprovalFilter = { type?: ApprovalType; status?: 'Pending' | 'Approved' | 'Rejected'; approverId?: string; requesterId?: string };

/**
 * Who sees an approval: HR and Admin see all; anyone else sees those they asked for, those they are (or were) an
 * approver on, and their team's.
 */
export async function visibility(q: Q, actor: Actor): Promise<((a: Pick<Approval, 'requesterId' | 'chain'>) => boolean)> {
  if (can(actor, 'employees', 'edit')) return () => true;
  const me = actor.employeeId ?? '';
  const team = new Set(me ? await reportsOf(q, me) : []);
  return (a) => a.requesterId === me || team.has(a.requesterId) || a.chain.some((s, i) => i > 0 && s.approverId === me);
}

export async function listApprovals(actor: Actor, f: ApprovalFilter): Promise<ApprovalWithSource[]> {
  let q = db.selectFrom('approvals').selectAll().where('status', '!=', 'Withdrawn').where('type', 'in', ownedTypes());
  if (f.type) q = q.where('type', '=', f.type);
  if (f.status) q = q.where('status', '=', f.status);
  if (f.requesterId) q = q.where('requesterId', '=', f.requesterId);
  if (f.approverId) q = q.where(sql<boolean>`plan @> ${JSON.stringify([{ approverId: f.approverId }])}::jsonb`);
  const rows = await q.orderBy('submitted', 'desc').orderBy('id', 'desc').execute();
  const visible = await visibility(db, actor);
  return withSources(db, (await toApprovals(db, rows)).filter(visible));
}

export async function getApproval(q: Q, id: string): Promise<ApprovalWithSource | null> {
  const row = await q.selectFrom('approvals').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) return null;
  return (await withSources(q, await toApprovals(q, [row])))[0] ?? null;
}

/** POST /approvals/:id/decision — only the current approver; a rejection needs a reason. */
export async function decide(actor: Actor, id: string, approve: boolean, comment?: string | null): Promise<ApprovalWithSource> {
  const note = comment?.trim() || null;
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('approvals').selectAll().where('id', '=', id).where('type', 'in', ownedTypes()).forUpdate().executeTakeFirst();
    if (!row || row.status === 'Withdrawn') throw notFound('Approval not found');
    if (row.status !== 'Pending') throw conflict('Already decided.');
    const plan = row.plan as unknown as PlanStep[];
    const step = plan[row.current - 1];
    if (!step || step.approverId !== actor.employeeId) throw forbidden('This request is waiting on someone else.');
    if (!approve && !(note && note.length > 2)) throw unprocessable('Give a reason for rejecting.', { comment: 'Required' });
    await recordDecision(tx, row, approve, note, { employeeId: actor.employeeId, name: actor.name });
    return (await getApproval(tx.db, id))!;
  });
}

type ApprovalRow = { id: string; type: string; sourceId: string; requesterId: string; current: number; plan: unknown; notify: unknown };

/**
 * Records the current step's decision and moves the request on: the next approver is told, or the outcome is
 * applied and the requester told. In the caller's transaction, with the row locked. `by` is whoever decided — the
 * approver, or (for an automatic approval) nobody: the system, on the approver's step.
 */
export async function recordDecision(tx: Tx, row: ApprovalRow, approve: boolean, note: string | null, by: { employeeId: string | null; name: string }) {
  const plan = row.plan as PlanStep[];
  const step = plan[row.current - 1];
  await tx.db.insertInto('approvalSteps').values({ approvalId: row.id, step: row.current, approverId: step.approverId, role: step.role, decision: approve ? 'Approved' : 'Rejected', comment: note }).execute();
  const last = row.current >= plan.length;
  const status = !approve ? 'Rejected' : last ? 'Approved' : 'Pending';
  await tx.db.updateTable('approvals')
    .set({ status, current: approve && !last ? row.current + 1 : row.current, decidedAt: status === 'Pending' ? null : new Date() })
    .where('id', '=', row.id).execute();
  await tx.audit(approve ? 'Approved' : 'Rejected', `${row.type} request`, row.sourceId, [
    { field: 'status', before: 'Pending', after: status === 'Pending' ? 'Pending · next approver' : status },
    ...(note ? [{ field: 'comment', before: null, after: note }] : []),
  ]);

  if (status === 'Pending') {
    await tx.notify({ recipientIds: [plan[row.current].approverId], kind: 'Approval', text: '', href: '/app/approvals', approvalId: row.id, actorId: row.requesterId });
  } else {
    await handlerFor(row.type).apply(tx, { id: row.id, type: row.type as ApprovalType, sourceId: row.sourceId, requesterId: row.requesterId, status }, note);
    const told = status === 'Approved' ? [row.requesterId, ...(row.notify as string[])] : [row.requesterId];
    await tx.notify({
      recipientIds: told.filter((x) => x !== by.employeeId), kind: 'Approval',
      text: `${by.name} ${status === 'Approved' ? 'approved' : 'rejected'} your ${row.type.toLowerCase()} request${note ? ` — “${note}”` : '.'}`,
      href: '/app/approvals', approvalId: row.id, actorId: by.employeeId,
    });
  }
}

/** POST /approvals/bulk-decision — approves each it can; one that changed in the meantime is skipped. */
export async function approveMany(actor: Actor, ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    try {
      await decide(actor, id, true);
      n++;
    } catch {
      /* already decided, not theirs, or gone: skip it */
    }
  }
  return n;
}

/** The requester recalled or cancelled it before a decision. In the caller's transaction. */
export async function withdraw(tx: Tx, approvalId: string | null) {
  if (!approvalId) return;
  const r = await tx.db.updateTable('approvals').set({ status: 'Withdrawn', decidedAt: new Date() }).where('id', '=', approvalId).where('status', '=', 'Pending').executeTakeFirst();
  if (Number(r.numUpdatedRows)) await tx.audit('Withdrawn', 'Approval', approvalId);
}
