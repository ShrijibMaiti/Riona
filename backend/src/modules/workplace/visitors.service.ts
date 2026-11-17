/**
 * Visitors: the reception list, pre-registration and the kiosk's check-in and check-out. Open to all staff (a
 * host registers their own visitors). Check-in hands out the lowest free badge for the day.
 */
import type { Visitor } from '@riona/shared';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowZoned, today } from '../../lib/dates';
import { F } from '../../lib/validate';

type Q = Kysely<DB> | Transaction<DB>;

export const NewVisitor = z.object({
  name: z.string({ required_error: 'Enter the visitor’s name.' }).max(200),
  company: z.string().max(200).default(''),
  hostId: z.string().min(1, 'Choose who they’re visiting.').max(40),
  purpose: z.string().max(300).default(''),
  date: F.date,
  expected: z.string().max(5).default(''),
  checkInNow: z.boolean().default(false),
});

const toVisitor = (v: { id: string; name: string; company: string; hostId: string; date: string; expected: string; checkedIn: string | null; checkedOut: string | null; purpose: string; badge: string | null }): Visitor =>
  ({ id: v.id, name: v.name, company: v.company, hostId: v.hostId, date: v.date, expected: v.expected, checkedIn: v.checkedIn, checkedOut: v.checkedOut, purpose: v.purpose, badge: v.badge });

/** The time now at the office, HH:MM. */
const clock = () => nowZoned().slice(11, 16);

/** The lowest V-NN badge not in use today (visitors still in the building). */
async function freeBadge(q: Q, date: string) {
  const used = new Set((await q.selectFrom('visitors').select('badge').where('date', '=', date).where('badge', 'is not', null).where('checkedOut', 'is', null).execute()).map((r) => r.badge));
  for (let n = 1; n < 1000; n++) if (!used.has('V-' + n)) return 'V-' + n;
  return 'V-' + Date.now();
}

/** GET /visitors?date */
export async function listVisitors(actor: Actor, date?: string): Promise<Visitor[]> {
  authorize(actor, 'directory', 'view');
  let q = db.selectFrom('visitors').selectAll();
  if (date) q = q.where('date', '=', date);
  return (await q.orderBy('date').orderBy('expected').orderBy('id').execute()).map(toVisitor);
}

/** POST /visitors/:id/check-in | check-out */
export async function checkVisitor(actor: Actor, id: string, action: 'in' | 'out'): Promise<Visitor> {
  authorize(actor, 'directory', 'view');
  return withTransaction(actor, async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.visitor-badges'))`.execute(tx.db);
    const v = await tx.db.selectFrom('visitors').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!v) throw notFound('Visitor not found');
    if (action === 'in') {
      if (v.checkedIn) throw conflict(`${v.name} is already checked in.`);
      if (v.date !== today()) throw conflict('This visit isn’t today.');
      await tx.db.updateTable('visitors').set({ checkedIn: clock(), badge: await freeBadge(tx.db, v.date) }).where('id', '=', id).execute();
    } else {
      if (!v.checkedIn) throw conflict(`${v.name} hasn’t checked in.`);
      if (v.checkedOut) throw conflict(`${v.name} has already left.`);
      await tx.db.updateTable('visitors').set({ checkedOut: clock() }).where('id', '=', id).execute();
    }
    await tx.audit(action === 'in' ? 'Checked in' : 'Checked out', 'Visitor', id);
    return toVisitor((await tx.db.selectFrom('visitors').selectAll().where('id', '=', id).executeTakeFirstOrThrow()));
  });
}

/** POST /visitors { name, company, hostId, purpose, date, expected, checkInNow } — the host is told. */
export async function registerVisitor(actor: Actor, input: z.infer<typeof NewVisitor>): Promise<Visitor> {
  authorize(actor, 'directory', 'view');
  if (!input.name.trim()) throw unprocessable('Enter the visitor’s name.', { name: 'Required' });
  if (input.checkInNow && input.date !== today()) throw unprocessable('Only today’s visitors can check in now.', { date: 'Not today' });
  return withTransaction(actor, async (tx) => {
    const host = await tx.db.selectFrom('employees').select(['id', 'status']).where('id', '=', input.hostId).executeTakeFirst();
    if (!host || host.status === 'Inactive') throw unprocessable('Choose who they’re visiting.', { hostId: 'Unknown' });
    await sql`SELECT pg_advisory_xact_lock(hashtext('riona.visitor-badges'))`.execute(tx.db);
    const v = {
      id: newId('VS'), name: input.name.trim(), company: input.company.trim(), hostId: input.hostId, date: input.date, expected: input.expected, purpose: input.purpose.trim(),
      checkedIn: input.checkInNow ? clock() : null, checkedOut: null, badge: input.checkInNow ? await freeBadge(tx.db, input.date) : null,
    };
    await tx.db.insertInto('visitors').values(v).execute();
    await tx.audit('Created', 'Visitor', v.id, [{ field: 'name', before: null, after: v.name }]);
    if (input.hostId !== actor.employeeId) {
      await tx.notify({ recipientIds: [input.hostId], kind: 'System', text: input.checkInNow ? `${v.name} is at reception for you` : `${v.name} is expected on ${v.date}`, href: '/app/workplace/visitors' });
    }
    return toVisitor(v);
  });
}
