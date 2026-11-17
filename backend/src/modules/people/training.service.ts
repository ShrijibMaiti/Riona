/** Training: the programme catalogue (all staff) and certifications (own, team, or all for HR and Admin). */
import type { Certification, TrainingProgramme } from '@riona/shared';
import { db } from '../../db/client';
import { authorize, can } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';

/** GET /training/programmes */
export async function listProgrammes(actor: Actor): Promise<TrainingProgramme[]> {
  authorize(actor, 'directory', 'view');
  const rows = await db.selectFrom('trainingProgrammes').selectAll().orderBy('id').execute();
  return rows.map((p) => ({ id: p.id, name: p.name, kind: p.kind as TrainingProgramme['kind'], mandatory: p.mandatory, validityMonths: p.validityMonths }));
}

/** GET /training/certifications?employeeId */
export async function listCertifications(actor: Actor, employeeId?: string): Promise<Certification[]> {
  if (!can(actor, 'training', 'view')) return [];
  const ids = await visibleEmployeeIds(db, actor, 'training');
  let q = db.selectFrom('certifications').selectAll();
  if (ids) q = q.where('employeeId', 'in', ids.length ? ids : ['-']);
  if (employeeId) q = q.where('employeeId', '=', employeeId);
  const rows = await q.orderBy('employeeId').orderBy('programmeId').orderBy('id').execute();
  return rows.map((c) => ({ id: c.id, programmeId: c.programmeId, employeeId: c.employeeId, completed: c.completed, expires: c.expires, status: c.status as Certification['status'] }));
}
