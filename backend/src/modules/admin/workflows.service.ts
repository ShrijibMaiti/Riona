/**
 * Approval workflows (Admin › Workflows). Saving never edits a definition in place: it appends a new version and
 * points the workflow at it, so requests already in flight keep the chain they were given.
 */
import type { Workflow } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { today } from '../../lib/dates';
import { F } from '../../lib/validate';

const MODULES = ['Leave', 'Expense', 'Timesheet', 'Regularisation', 'Invoice', 'Profile change', 'Onboarding'] as const;

/** PUT /workflows/:id — the whole workflow as the builder holds it. */
export const WorkflowInput = z.object({
  id: z.string().min(1).max(40),
  name: F.text(120).min(1, 'Give the workflow a name.'),
  module: z.enum(MODULES),
  status: z.enum(['Active', 'Paused', 'Draft']),
  nodes: z.array(z.object({
    id: z.string().min(1).max(60),
    kind: z.enum(['Trigger', 'Condition', 'Approver', 'Notification', 'Outcome']),
    label: F.text(120),
    x: z.number(),
    y: z.number(),
    config: z.record(z.string().max(200)),
  })).min(1).max(100),
  edges: z.array(z.object({ id: z.string().min(1).max(60), from: z.string(), to: z.string(), label: z.string().max(40).optional() })).max(200),
}).strip();

async function load(id?: string): Promise<Workflow[]> {
  let q = db
    .selectFrom('workflows as w')
    .innerJoin('workflowVersions as v', (j) => j.onRef('v.workflowId', '=', 'w.id').onRef('v.version', '=', 'w.currentVersion'))
    .select(['w.id', 'w.name', 'w.module', 'w.status', 'w.updated', 'v.definition']);
  if (id) q = q.where('w.id', '=', id);
  const rows = await q.orderBy('w.id').execute();
  return rows.map((r) => {
    const d = r.definition as unknown as Pick<Workflow, 'nodes' | 'edges'>;
    return { id: r.id, name: r.name, module: r.module as Workflow['module'], status: r.status as Workflow['status'], updated: r.updated, nodes: d.nodes, edges: d.edges };
  });
}

export async function listWorkflows(actor: Actor): Promise<Workflow[]> {
  authorize(actor, 'workflows', 'view');
  return load();
}

export async function getWorkflow(actor: Actor, id: string): Promise<Workflow> {
  authorize(actor, 'workflows', 'view');
  const [w] = await load(id);
  if (!w) throw notFound('Workflow not found');
  return w;
}

export async function saveWorkflow(actor: Actor, id: string, w: z.infer<typeof WorkflowInput>): Promise<Workflow> {
  authorize(actor, 'workflows', 'edit');
  if (w.id !== id) throw unprocessable('The workflow id doesn’t match the address.');
  const ids = new Set(w.nodes.map((n) => n.id));
  if (ids.size !== w.nodes.length) throw unprocessable('Two steps share an id.');
  if (w.nodes.filter((n) => n.kind === 'Trigger').length !== 1) throw unprocessable('A workflow needs exactly one Trigger.');
  if (!w.nodes.some((n) => n.kind === 'Outcome')) throw unprocessable('A workflow needs at least one Outcome.');
  if (w.edges.some((e) => !ids.has(e.from) || !ids.has(e.to))) throw unprocessable('A connection points at a step that no longer exists.');
  return withTransaction(actor, async (tx) => {
    const cur = await tx.db.selectFrom('workflows').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!cur) throw notFound('Workflow not found');
    if (w.module !== cur.module) throw unprocessable('A workflow can’t move to another module. Create a new one instead.');
    if (w.status === 'Active' && cur.module !== 'Onboarding') {
      const other = await tx.db.selectFrom('workflows').select('name').where('module', '=', cur.module).where('status', '=', 'Active').where('id', '!=', id).executeTakeFirst();
      if (other) throw conflict(`“${other.name}” is already active for ${cur.module}. Pause it first.`);
    }
    const version = cur.currentVersion + 1;
    await tx.db.insertInto('workflowVersions').values({ workflowId: id, version, definition: JSON.stringify({ nodes: w.nodes, edges: w.edges }), createdBy: actor.employeeId }).execute();
    await tx.db.updateTable('workflows').set({ name: w.name, status: w.status, currentVersion: version, updated: today() }).where('id', '=', id).execute();
    await tx.audit('Updated', 'Workflow', id, [
      { field: 'version', before: String(cur.currentVersion), after: String(version) },
      ...(cur.status !== w.status ? [{ field: 'status', before: cur.status, after: w.status }] : []),
      ...(cur.name !== w.name ? [{ field: 'name', before: cur.name, after: w.name }] : []),
    ]);
    return (await load(id))[0];
  });
}
