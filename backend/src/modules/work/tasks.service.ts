/**
 * Tasks: read by every staff member; changed by the project's team (its manager, members and the assignee) or by
 * HR and Admin. Every change is audited; comments only ever append.
 */
import type { Task } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, can, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { diff } from '../../engines/audit/audit';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso, today } from '../../lib/dates';
import { F, opt } from '../../lib/validate';
import { isOnProject } from './projects.service';

const STATUS = z.enum(['todo', 'progress', 'review', 'done']);
const PRIORITY = z.enum(['Urgent', 'High', 'Medium', 'Low']);

/** GET /tasks?projectId&assigneeId&status */
export const TaskFilter = z.object({ projectId: opt(z.string().max(40)), assigneeId: opt(z.string().max(40)), status: opt(STATUS) });

/** PATCH /tasks/:id */
export const TaskPatch = z
  .object({
    status: STATUS,
    assigneeId: z.string().min(1).max(40),
    due: F.date,
    priority: PRIORITY,
    title: F.text(200).min(1, 'Give the task a title.'),
    description: F.text(10_000),
    subtasks: z.array(z.object({ id: z.string().min(1).max(40), title: F.text(200).min(1), done: z.boolean() })).max(100),
  })
  .partial()
  .strip();

/** POST /projects/:id/tasks */
export const NewTask = z.object({
  title: F.text(200).min(1, 'Give the task a title.'),
  assigneeId: z.string().min(1, 'Choose who it’s for.').max(40),
  due: F.date,
  priority: PRIORITY.default('Medium'),
  estimateHours: z.number().min(0).max(1000).default(0),
});

/** POST /tasks/:id/comments */
export const NewComment = z.object({ text: F.text(5000).min(1, 'Write a comment first.') });

type Q = Kysely<DB> | Transaction<DB>;

async function loadTasks(q: Q, where: { id?: string; projectId?: string; assigneeId?: string; status?: string }): Promise<Task[]> {
  let tq = q.selectFrom('tasks').selectAll();
  if (where.id) tq = tq.where('id', '=', where.id);
  if (where.projectId) tq = tq.where('projectId', '=', where.projectId);
  if (where.assigneeId) tq = tq.where('assigneeId', '=', where.assigneeId);
  if (where.status) tq = tq.where('status', '=', where.status);
  const rows = await tq.orderBy('projectId').orderBy('position').execute();
  if (!rows.length) return [];
  const comments = await q.selectFrom('taskComments').selectAll().where('taskId', 'in', rows.map((r) => r.id)).orderBy('at').orderBy('id').execute();
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, title: r.title, status: r.status as Task['status'], priority: r.priority as Task['priority'],
    assigneeId: r.assigneeId ?? '', due: r.due, estimateHours: r.estimateHours, phaseId: r.phaseId, created: r.created,
    subtasks: r.subtasks as Task['subtasks'], description: r.description,
    comments: comments.filter((c) => c.taskId === r.id).map((c) => ({ id: c.id, authorId: c.authorId ?? '', at: c.at, text: c.text })),
  }));
}

export async function listTasks(actor: Actor, f: z.infer<typeof TaskFilter>): Promise<Task[]> {
  authorize(actor, 'tasks', 'view');
  return loadTasks(db, f);
}

export async function getTask(actor: Actor, id: string): Promise<Task> {
  authorize(actor, 'tasks', 'view');
  const [t] = await loadTasks(db, { id });
  if (!t) throw notFound('Task not found');
  return t;
}

/** HR and Admin change any task; anyone else must be on the project's team or be the assignee. */
async function mayChange(q: Q, actor: Actor, projectId: string, assigneeId: string | null) {
  if (can(actor, 'employees', 'edit')) return;
  if (assigneeId && assigneeId === actor.employeeId) return;
  if (await isOnProject(q, projectId, actor.employeeId)) return;
  throw forbidden('Only the project team can change this task.');
}

async function assertEmployee(q: Q, id: string) {
  const e = await q.selectFrom('employees').select('id').where('id', '=', id).executeTakeFirst();
  if (!e) throw unprocessable('Choose someone from the directory.', { assigneeId: 'Unknown' });
}

export async function updateTask(actor: Actor, id: string, patch: z.infer<typeof TaskPatch>): Promise<Task> {
  authorize(actor, 'tasks', 'edit');
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('tasks').select(['id', 'projectId', 'assigneeId']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Task not found');
    await mayChange(tx.db, actor, row.projectId, row.assigneeId);
    if (patch.assigneeId) await assertEmployee(tx.db, patch.assigneeId);
    const [before] = await loadTasks(tx.db, { id });
    const { subtasks, ...rest } = patch;
    const set = { ...rest, ...(subtasks ? { subtasks: JSON.stringify(subtasks) } : {}) };
    if (Object.keys(set).length) await tx.db.updateTable('tasks').set(set).where('id', '=', id).execute();
    const [after] = await loadTasks(tx.db, { id });
    const changes = diff(before, after, ['status', 'assigneeId', 'due', 'priority', 'title', 'description', 'subtasks']);
    if (changes.length) await tx.audit('Updated', 'Task', id, changes);
    return after;
  });
}

export async function createTask(actor: Actor, projectId: string, input: z.infer<typeof NewTask>): Promise<Task> {
  authorize(actor, 'tasks', 'edit');
  return withTransaction(actor, async (tx) => {
    // Lock the project so two tasks created at once can't take the same number.
    const p = await tx.db.selectFrom('projects').select(['id', 'code']).where('id', '=', projectId).forUpdate().executeTakeFirst();
    if (!p) throw notFound('Project not found');
    await mayChange(tx.db, actor, projectId, null);
    await assertEmployee(tx.db, input.assigneeId);
    const last = await tx.db
      .selectFrom('tasks')
      .select(sql<number>`max(substring(id from '-(\\d+)$')::int)`.as('n'))
      .where('projectId', '=', projectId)
      .executeTakeFirst();
    const id = `${p.code}-${(last?.n ?? 0) + 1}`;
    await tx.db
      .insertInto('tasks')
      .values({ id, projectId, title: input.title, status: 'todo', priority: input.priority, assigneeId: input.assigneeId, due: input.due, estimateHours: input.estimateHours, created: today() })
      .execute();
    await tx.audit('Created', 'Task', id, [{ field: 'title', before: null, after: input.title }]);
    if (input.assigneeId !== actor.employeeId) {
      await tx.notify({ recipientIds: [input.assigneeId], kind: 'Mention', text: `${actor.name} assigned you ${id} · ${input.title}`, href: `/app/work/projects/${projectId}`, actorId: actor.employeeId });
    }
    return (await loadTasks(tx.db, { id }))[0];
  });
}

export async function addComment(actor: Actor, taskId: string, text: string): Promise<Task> {
  authorize(actor, 'tasks', 'view');
  const me = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const t = await tx.db.selectFrom('tasks').select(['id', 'projectId']).where('id', '=', taskId).executeTakeFirst();
    if (!t) throw notFound('Task not found');
    const id = newId('CM');
    await tx.db.insertInto('taskComments').values({ id, taskId, authorId: me, at: nowIso(), text }).execute();
    await tx.audit('Commented', 'Task', taskId);
    return (await loadTasks(tx.db, { id: taskId }))[0];
  });
}
