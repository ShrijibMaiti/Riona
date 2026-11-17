/**
 * Attendance marks and public holidays. Marks are personal: HR and Admin see everyone's, a manager their team's,
 * an employee their own. A request for someone outside that answers an empty list, never a 403.
 */
import type { AttendanceDay, Holiday } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { unprocessable } from '../../lib/errors';
import { F, opt } from '../../lib/validate';

/** GET /attendance?employeeId&from&to — from and to are required, so a request can't pull all of history by accident. */
export const AttendanceQuery = z.object({ employeeId: opt(z.string().max(40)), from: F.date, to: F.date });

export async function getAttendance(actor: Actor, f: z.infer<typeof AttendanceQuery>): Promise<AttendanceDay[]> {
  authorize(actor, 'attendance', 'view');
  if (f.to < f.from) throw unprocessable('The end date is before the start date.', { to: 'Before from' });
  const ids = await visibleEmployeeIds(db, actor, 'attendance');
  if (ids && !ids.length) return [];
  if (f.employeeId && ids && !ids.includes(f.employeeId)) return [];
  let q = db.selectFrom('attendance').selectAll().where('date', '>=', f.from).where('date', '<=', f.to);
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  else if (ids) q = q.where('employeeId', 'in', ids);
  const rows = await q.orderBy('date').orderBy('employeeId').execute();
  return rows.map((r) => ({
    id: r.id, employeeId: r.employeeId, date: r.date, mark: r.mark as AttendanceDay['mark'], in: r.inTime, out: r.outTime,
    ...(r.regularisedFrom ? { regularisedFrom: r.regularisedFrom as AttendanceDay['mark'] } : {}),
  }));
}

export async function getHolidays(): Promise<Holiday[]> {
  return db.selectFrom('holidays').select(['date', 'name']).orderBy('date').execute();
}
