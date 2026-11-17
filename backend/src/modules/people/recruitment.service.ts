/**
 * Recruitment: openings and their candidates. HR and Admin see and move everything (recruitment:edit); a manager
 * sees the openings they are hiring for, and moves those candidates. Others see none.
 */
import type { Candidate, CandidateStage, Job } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { can } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { forbidden, notFound } from '../../lib/errors';

const STAGES = ['Applied', 'Screening', 'Interviewing', 'Offer', 'Hired', 'Rejected'] as const;
export const MoveCandidate = z.object({ stage: z.enum(STAGES, { errorMap: () => ({ message: 'Choose a stage.' }) }) });

/** Which openings the actor may see: null = all. */
function jobScope(actor: Actor): { all: true } | { managerId: string } | null {
  if (can(actor, 'recruitment', 'edit')) return { all: true };
  if (can(actor, 'recruitment', 'view') && actor.employeeId) return { managerId: actor.employeeId };
  return null;
}

const toJob = (j: { id: string; title: string; dept: string; location: string; openings: number; status: string; posted: string; hiringManagerId: string }): Job => ({
  id: j.id, title: j.title, dept: j.dept as Job['dept'], location: j.location, openings: j.openings, status: j.status as Job['status'], posted: j.posted, hiringManagerId: j.hiringManagerId,
});
const toCandidate = (c: { id: string; jobId: string; name: string; email: string; source: string; stage: string; applied: string; experienceYears: number; currentCompany: string; notes: string; interviews: unknown }): Candidate => ({
  id: c.id, jobId: c.jobId, name: c.name, email: c.email, source: c.source, stage: c.stage as CandidateStage, applied: c.applied,
  experienceYears: c.experienceYears, currentCompany: c.currentCompany, notes: c.notes, interviews: c.interviews as Candidate['interviews'],
});

function jobsQuery(actor: Actor) {
  const s = jobScope(actor);
  if (!s) return null;
  let q = db.selectFrom('jobs').selectAll();
  if ('managerId' in s) q = q.where('hiringManagerId', '=', s.managerId);
  return q;
}

/** GET /jobs */
export async function listJobs(actor: Actor): Promise<Job[]> {
  const q = jobsQuery(actor);
  return q ? (await q.orderBy('posted', 'desc').orderBy('id').execute()).map(toJob) : [];
}
/** GET /jobs/:id */
export async function getJob(actor: Actor, id: string): Promise<Job> {
  const q = jobsQuery(actor);
  const j = q ? await q.where('id', '=', id).executeTakeFirst() : undefined;
  if (!j) throw notFound('Job not found');
  return toJob(j);
}

function candidatesQuery(actor: Actor) {
  const s = jobScope(actor);
  if (!s) return null;
  let q = db.selectFrom('candidates').selectAll();
  if ('managerId' in s) q = q.where('jobId', 'in', db.selectFrom('jobs').select('id').where('hiringManagerId', '=', s.managerId));
  return q;
}

/** GET /candidates?jobId */
export async function listCandidates(actor: Actor, jobId?: string): Promise<Candidate[]> {
  let q = candidatesQuery(actor);
  if (!q) return [];
  if (jobId) q = q.where('jobId', '=', jobId);
  return (await q.orderBy('applied', 'desc').orderBy('id').execute()).map(toCandidate);
}
/** GET /candidates/:id */
export async function getCandidate(actor: Actor, id: string): Promise<Candidate> {
  const q = candidatesQuery(actor);
  const c = q ? await q.where('id', '=', id).executeTakeFirst() : undefined;
  if (!c) throw notFound('Candidate not found');
  return toCandidate(c);
}

/** PATCH /candidates/:id { stage } — HR, Admin, or the opening's hiring manager. */
export async function moveCandidate(actor: Actor, id: string, stage: CandidateStage): Promise<Candidate> {
  const visible = await getCandidate(actor, id); // 404 outside scope
  if (!can(actor, 'recruitment', 'edit')) {
    const job = await db.selectFrom('jobs').select('hiringManagerId').where('id', '=', visible.jobId).executeTakeFirstOrThrow();
    if (job.hiringManagerId !== actor.employeeId) throw forbidden('Only HR or the hiring manager can move candidates.');
  }
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('candidates').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
    if (row.stage !== stage) {
      await tx.db.updateTable('candidates').set({ stage }).where('id', '=', id).execute();
      await tx.audit('Updated', 'Candidate', id, [{ field: 'stage', before: row.stage, after: stage }]);
    }
    return toCandidate({ ...row, stage });
  });
}
