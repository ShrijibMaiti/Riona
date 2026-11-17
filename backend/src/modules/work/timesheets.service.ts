/**
 * Timesheets. Each person fills in their own week (save replaces the week's draft rows), submits it for the project
 * manager's approval, and can recall it while it is pending. Every submit, rejection and approval appends a revision
 * with the entries as they stood, so a week can be shown "as first submitted" later (the dual-state history).
 *
 * Who sees whose hours: your own; a manager their team's and everyone's on projects they manage; HR and Admin all.
 */
import type { TimesheetEntry, TimesheetWeek } from '@riona/shared';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB, TimesheetEntries, TimesheetWeeks } from '../../db/schema';
import { withTransaction, type Tx } from '../../db/tx';
import { authorize, can, selfId } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { openApproval, withdraw } from '../../engines/approvals/engine';
import type { OutcomeHandler } from '../../engines/approvals/outcomes';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { addDays, isoDow, nowZoned } from '../../lib/dates';
import { F, opt } from '../../lib/validate';

type Q = Kysely<DB> | Transaction<DB>;
const STATUS = z.enum(['Draft', 'Submitted', 'Approved', 'Rejected']);

/** GET /timesheet-entries?employeeId&projectId&clientId&from&to&status&billable&ids */
export const EntryFilter = z.object({
  employeeId: opt(z.string().max(40)),
  projectId: opt(z.string().max(40)),
  clientId: opt(z.string().max(40)),
  from: opt(F.date),
  to: opt(F.date),
  status: opt(STATUS),
  billable: opt(z.enum(['true', 'false']).transform((v) => v === 'true')),
  ids: opt(z.string().transform((s) => s.split(',').filter(Boolean))),
});
/** GET /timesheet-weeks?employeeId&weekStart&status */
export const WeekFilter = z.object({ employeeId: opt(z.string().max(40)), weekStart: opt(F.date), status: opt(STATUS) });

/** PUT /timesheet-weeks/:employeeId/:weekStart { rows } */
export const SaveWeek = z.object({
  rows: z.array(z.object({
    projectId: z.string().min(1, 'Choose a project.').max(40),
    taskId: z.string().max(40).nullable().default(null),
    note: F.text(500).default(''),
    billable: z.boolean().default(false),
    hours: z.array(z.number().min(0, 'Hours can’t be negative.').max(24).multipleOf(0.25, 'Use quarter hours.')).length(7, 'A week has seven days.'),
  })).max(50),
});

export const toEntry = (r: Selectable<TimesheetEntries>): TimesheetEntry => ({
  id: r.id, employeeId: r.employeeId, projectId: r.projectId, clientId: r.clientId, taskId: r.taskId, date: r.date, hours: r.hours,
  billable: r.billable, note: r.note, status: r.status as TimesheetEntry['status'],
});
const toWeek = (r: Selectable<TimesheetWeeks>): TimesheetWeek => ({
  id: r.id, employeeId: r.employeeId, weekStart: r.weekStart, status: r.status as TimesheetWeek['status'], approvalId: r.approvalId,
  revisions: r.revisions as TimesheetWeek['revisions'],
});
const weekId = (employeeId: string, weekStart: string) => 'TW-' + employeeId.slice(2) + '-' + weekStart.replace(/-/g, '');
const weekEntries = (q: Q, employeeId: string, weekStart: string) =>
  q.selectFrom('timesheetEntries').selectAll().where('employeeId', '=', employeeId).where('date', '>=', weekStart).where('date', '<=', addDays(weekStart, 6)).orderBy('date').orderBy('id').execute();

/** The employees (or null for everyone) and, for a manager, the projects whose hours the actor may see. */
async function scopeOf(actor: Actor) {
  const employees = await visibleEmployeeIds(db, actor, 'timesheets');
  if (!employees) return null;
  const projects = actor.employeeId && can(actor, 'timesheets', 'approve')
    ? (await db.selectFrom('projects').select('id').where('managerId', '=', actor.employeeId).execute()).map((p) => p.id)
    : [];
  return { employees, projects };
}

export async function listEntries(actor: Actor, f: z.infer<typeof EntryFilter>): Promise<TimesheetEntry[]> {
  authorize(actor, 'timesheets', 'view');
  const scope = await scopeOf(actor);
  let q = db.selectFrom('timesheetEntries').selectAll();
  if (scope) {
    const { employees, projects } = scope;
    if (!employees.length && !projects.length) return [];
    q = q.where((eb) => eb.or([
      ...(employees.length ? [eb('employeeId', 'in', employees)] : []),
      ...(projects.length ? [eb('projectId', 'in', projects)] : []),
    ]));
  }
  if (f.ids) {
    if (!f.ids.length) return [];
    q = q.where('id', 'in', f.ids);
  }
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  if (f.projectId) q = q.where('projectId', '=', f.projectId);
  if (f.clientId) q = q.where('clientId', '=', f.clientId);
  if (f.from) q = q.where('date', '>=', f.from);
  if (f.to) q = q.where('date', '<=', f.to);
  if (f.status) q = q.where('status', '=', f.status);
  if (f.billable !== undefined) q = q.where('billable', '=', f.billable);
  return (await q.orderBy('date').orderBy('id').execute()).map(toEntry);
}

export async function listWeeks(actor: Actor, f: z.infer<typeof WeekFilter>): Promise<TimesheetWeek[]> {
  authorize(actor, 'timesheets', 'view');
  const ids = await visibleEmployeeIds(db, actor, 'timesheets');
  if (ids && (!ids.length || (f.employeeId && !ids.includes(f.employeeId)))) return [];
  let q = db.selectFrom('timesheetWeeks').selectAll();
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  else if (ids) q = q.where('employeeId', 'in', ids);
  if (f.weekStart) q = q.where('weekStart', '=', f.weekStart);
  if (f.status) q = q.where('status', '=', f.status);
  return (await q.orderBy('weekStart').orderBy('employeeId').execute()).map(toWeek);
}

function ownWeek(actor: Actor, employeeId: string, weekStart: string) {
  const me = selfId(actor);
  if (employeeId !== me) throw forbidden('You can only fill in your own timesheet.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || isoDow(weekStart) !== 1) throw unprocessable('A timesheet week starts on a Monday.', { weekStart: 'Not a Monday' });
  return me;
}

export async function saveWeek(actor: Actor, employeeId: string, weekStart: string, rows: z.infer<typeof SaveWeek>['rows']): Promise<TimesheetEntry[]> {
  const me = ownWeek(actor, employeeId, weekStart);
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) r.hours.forEach((h, i) => (perDay[i] += h));
  const over = perDay.findIndex((h) => h > 24);
  if (over >= 0) throw unprocessable(`That’s more than 24 hours on ${addDays(weekStart, over)}.`, { hours: 'Over 24' });
  return withTransaction(actor, async (tx) => {
    const wk = await tx.db.selectFrom('timesheetWeeks').selectAll().where('employeeId', '=', me).where('weekStart', '=', weekStart).forUpdate().executeTakeFirst();
    if (wk && (wk.status === 'Submitted' || wk.status === 'Approved')) throw conflict('This week is submitted. Recall it to edit.');
    const projectIds = [...new Set(rows.map((r) => r.projectId))];
    const projects = projectIds.length ? await tx.db.selectFrom('projects').select(['id', 'clientId']).where('id', 'in', projectIds).execute() : [];
    for (const r of rows) {
      if (!projects.some((p) => p.id === r.projectId)) throw unprocessable('Choose a project from the list.', { projectId: 'Unknown' });
      if (r.taskId) {
        const t = await tx.db.selectFrom('tasks').select('projectId').where('id', '=', r.taskId).executeTakeFirst();
        if (!t || t.projectId !== r.projectId) throw unprocessable('That task isn’t on this project.', { taskId: 'Wrong project' });
      }
    }
    await tx.db.deleteFrom('timesheetEntries').where('employeeId', '=', me).where('date', '>=', weekStart).where('date', '<=', addDays(weekStart, 6)).where('status', 'in', ['Draft', 'Rejected']).execute();
    const values = rows.flatMap((r) => {
      const clientId = projects.find((p) => p.id === r.projectId)!.clientId;
      return r.hours.flatMap((h, i) => (h ? [{ id: newId('TE'), employeeId: me, projectId: r.projectId, clientId, taskId: r.taskId, date: addDays(weekStart, i), hours: h, billable: r.billable, note: r.note, status: 'Draft' }] : []));
    });
    if (values.length) await tx.db.insertInto('timesheetEntries').values(values).execute();
    if (wk) await tx.db.updateTable('timesheetWeeks').set({ status: 'Draft' }).where('id', '=', wk.id).execute();
    else await tx.db.insertInto('timesheetWeeks').values({ id: weekId(me, weekStart), employeeId: me, weekStart, status: 'Draft' }).execute();
    await tx.audit('Saved', 'Timesheet week', wk?.id ?? weekId(me, weekStart), [{ field: 'hours', before: null, after: String(perDay.reduce((a, b) => a + b, 0)) }]);
    return (await weekEntries(tx.db, me, weekStart)).map(toEntry);
  });
}

/** A revision: the week's totals and its entries as they stand right now. */
async function revision(tx: Tx, employeeId: string, weekStart: string, status: TimesheetWeek['status'], note: string) {
  const entries = (await weekEntries(tx.db, employeeId, weekStart)).map(toEntry);
  const total = entries.reduce((a, e) => a + e.hours, 0), billable = entries.filter((e) => e.billable).reduce((a, e) => a + e.hours, 0);
  return { at: nowZoned(), status, totalHours: total, billableHours: billable, note, entries };
}

export async function submitWeek(actor: Actor, employeeId: string, weekStart: string): Promise<TimesheetWeek> {
  const me = ownWeek(actor, employeeId, weekStart);
  return withTransaction(actor, async (tx) => {
    const wk = await tx.db.selectFrom('timesheetWeeks').selectAll().where('employeeId', '=', me).where('weekStart', '=', weekStart).forUpdate().executeTakeFirst();
    const entries = await weekEntries(tx.db, me, weekStart);
    if (!wk || !entries.length) throw notFound('Nothing logged this week');
    if (wk.status !== 'Draft' && wk.status !== 'Rejected') throw conflict('This week is already submitted.');
    await tx.db.updateTable('timesheetEntries').set({ status: 'Submitted' }).where('id', 'in', entries.map((e) => e.id)).execute();
    const rev = await revision(tx, me, weekStart, 'Submitted', '');
    // The approver is the manager of the project most of the week's hours went to.
    const byProject = entries.reduce<Record<string, number>>((o, e) => ((o[e.projectId] = (o[e.projectId] ?? 0) + e.hours), o), {});
    const top = Object.entries(byProject).sort((a, b) => b[1] - a[1])[0][0];
    const pm = (await tx.db.selectFrom('projects').select('managerId').where('id', '=', top).executeTakeFirst())?.managerId ?? null;
    const ap = await openApproval(tx, { type: 'Timesheet', sourceId: wk.id, requesterId: me, facts: { hours: rev.totalHours }, projectManagerId: pm });
    await tx.db.updateTable('timesheetWeeks')
      .set({ status: ap.status === 'Pending' ? 'Submitted' : ap.status, approvalId: ap.id, revisions: JSON.stringify([...(wk.revisions as object[]), rev]) })
      .where('id', '=', wk.id).execute();
    await tx.audit('Submitted', 'Timesheet week', wk.id, [{ field: 'status', before: wk.status, after: 'Submitted' }]);
    return toWeek((await tx.db.selectFrom('timesheetWeeks').selectAll().where('id', '=', wk.id).executeTakeFirstOrThrow()));
  });
}

export async function recallWeek(actor: Actor, employeeId: string, weekStart: string): Promise<TimesheetWeek> {
  const me = ownWeek(actor, employeeId, weekStart);
  return withTransaction(actor, async (tx) => {
    const wk = await tx.db.selectFrom('timesheetWeeks').selectAll().where('employeeId', '=', me).where('weekStart', '=', weekStart).forUpdate().executeTakeFirst();
    if (!wk || wk.status !== 'Submitted') throw conflict('Only a submitted week can be recalled.');
    await withdraw(tx, wk.approvalId);
    await tx.db.updateTable('timesheetEntries').set({ status: 'Draft' }).where('employeeId', '=', me).where('date', '>=', weekStart).where('date', '<=', addDays(weekStart, 6)).execute();
    await tx.db.updateTable('timesheetWeeks').set({ status: 'Draft', approvalId: null }).where('id', '=', wk.id).execute();
    await tx.audit('Recalled', 'Timesheet week', wk.id, [{ field: 'status', before: 'Submitted', after: 'Draft' }]);
    return toWeek((await tx.db.selectFrom('timesheetWeeks').selectAll().where('id', '=', wk.id).executeTakeFirstOrThrow()));
  });
}

export const timesheetOutcome: OutcomeHandler = {
  loadSources: async (q, ids) => {
    const weeks = ids.length ? await q.selectFrom('timesheetWeeks').selectAll().where('id', 'in', ids).execute() : [];
    const out = new Map<string, { kind: 'Timesheet'; week: TimesheetWeek; entries: TimesheetEntry[] }>();
    for (const w of weeks) out.set(w.id, { kind: 'Timesheet', week: toWeek(w), entries: (await weekEntries(q, w.employeeId, w.weekStart)).map(toEntry) });
    return out;
  },
  apply: async (tx, a, comment) => {
    const wk = await tx.db.selectFrom('timesheetWeeks').selectAll().where('id', '=', a.sourceId).forUpdate().executeTakeFirst();
    if (!wk) return;
    await tx.db.updateTable('timesheetEntries').set({ status: a.status })
      .where('employeeId', '=', wk.employeeId).where('date', '>=', wk.weekStart).where('date', '<=', addDays(wk.weekStart, 6)).execute();
    const rev = await revision(tx, wk.employeeId, wk.weekStart, a.status, comment ?? '');
    await tx.db.updateTable('timesheetWeeks').set({ status: a.status, revisions: JSON.stringify([...(wk.revisions as object[]), rev]) }).where('id', '=', wk.id).execute();
  },
};
