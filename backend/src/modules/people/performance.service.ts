/**
 * Performance: review cycles, reviews and goals.
 * Who sees a review: the employee, their reviewer, their managers up the line, HR and Admin.
 * Who writes what:
 *   - the employee: their self-review, and submitting it (Not started → Self review → Manager review)
 *   - the reviewer: the manager section, the rating, and completing it (Manager review → Completed)
 *   - HR and Admin: anything, including reopening
 * A completed review is locked for everyone but HR and Admin.
 */
import type { Goal, Review, ReviewCycle } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, can } from '../../auth/rbac/authorize';
import { visibleEmployeeIds } from '../../auth/rbac/scope';
import type { Actor } from '../../http/plugins/session';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { opt } from '../../lib/validate';

type Q = Kysely<DB> | Transaction<DB>;
const STATUSES = ['Not started', 'Self review', 'Manager review', 'Completed'] as const;
const RATINGS = ['Exceeds expectations', 'Meets expectations', 'Below expectations'] as const;

export const ReviewFilter = z.object({ cycleId: opt(z.string().max(40)), employeeId: opt(z.string().max(40)) });
export const ReviewPatch = z.object({
  selfAnswers: z.array(z.string().max(5000)).max(20).optional(),
  managerAnswers: z.array(z.string().max(5000)).max(20).optional(),
  rating: z.enum(RATINGS).nullable().optional(),
  status: z.enum(STATUSES).optional(),
});

const toReview = (r: { id: string; cycleId: string; employeeId: string; reviewerId: string; status: string; rating: string | null; selfAnswers: unknown; managerAnswers: unknown }): Review => ({
  id: r.id, cycleId: r.cycleId, employeeId: r.employeeId, reviewerId: r.reviewerId, status: r.status as Review['status'], rating: r.rating as Review['rating'],
  selfAnswers: r.selfAnswers as string[], managerAnswers: r.managerAnswers as string[],
});

/** GET /review-cycles */
export async function listCycles(actor: Actor): Promise<ReviewCycle[]> {
  authorize(actor, 'directory', 'view');
  const rows = await db.selectFrom('reviewCycles').selectAll().orderBy('selfDue', 'desc').execute();
  return rows.map((c) => ({ id: c.id, name: c.name, period: c.period, stage: c.stage as ReviewCycle['stage'], selfDue: c.selfDue, managerDue: c.managerDue }));
}

/** The reviews the actor may see: their own and their team's (or all), plus those they write. */
function reviewsQuery(q: Q, actor: Actor, ids: string[] | null) {
  let rq = q.selectFrom('reviews').selectAll();
  if (ids) {
    const me = actor.employeeId ?? '-';
    rq = rq.where((eb) => eb.or([eb('employeeId', 'in', ids.length ? ids : ['-']), eb('reviewerId', '=', me)]));
  }
  return rq;
}

/** GET /reviews?cycleId&employeeId */
export async function listReviews(actor: Actor, f: z.infer<typeof ReviewFilter>): Promise<Review[]> {
  if (!can(actor, 'performance', 'view')) return [];
  let q = reviewsQuery(db, actor, await visibleEmployeeIds(db, actor, 'performance'));
  if (f.cycleId) q = q.where('cycleId', '=', f.cycleId);
  if (f.employeeId) q = q.where('employeeId', '=', f.employeeId);
  return (await q.orderBy('cycleId').orderBy('employeeId').execute()).map(toReview);
}

/** GET /reviews/:id */
export async function getReview(actor: Actor, id: string): Promise<Review> {
  authorize(actor, 'performance', 'view');
  const r = await reviewsQuery(db, actor, await visibleEmployeeIds(db, actor, 'performance')).where('id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Review not found');
  return toReview(r);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** PUT /reviews/:id { selfAnswers, managerAnswers, rating, status } — each side writes its own part. */
export async function saveReview(actor: Actor, id: string, patch: z.infer<typeof ReviewPatch>): Promise<Review> {
  authorize(actor, 'performance', 'edit');
  return withTransaction(actor, async (tx) => {
    const visible = await reviewsQuery(tx.db, actor, await visibleEmployeeIds(tx.db, actor, 'performance')).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!visible) throw notFound('Review not found');
    const r = toReview(visible);
    const hr = can(actor, 'employees', 'edit');
    const self = r.employeeId === actor.employeeId;
    const reviewer = r.reviewerId === actor.employeeId;
    if (!hr && r.status === 'Completed') throw conflict('This review is complete. Ask HR to reopen it.');

    const next = { ...r, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Review;
    const changed = (k: keyof Review) => !same(r[k], next[k]);
    if (!hr) {
      if (changed('selfAnswers') && !self) throw forbidden('Only the employee writes their self-review.');
      if ((changed('managerAnswers') || changed('rating')) && !reviewer) throw forbidden('Only the reviewer writes the manager section and rating.');
      if (changed('status')) {
        const from = STATUSES.indexOf(r.status), to = STATUSES.indexOf(next.status);
        const ok = (self && to > from && to <= STATUSES.indexOf('Manager review')) || (reviewer && to > from && from >= STATUSES.indexOf('Self review'));
        if (!ok) throw forbidden('You can’t move this review to “' + next.status + '”.');
      }
    }
    if (next.status === 'Completed' && !next.rating) throw unprocessable('Choose a rating before completing the review.', { rating: 'Required' });

    const fields = (['selfAnswers', 'managerAnswers', 'rating', 'status'] as const).filter(changed);
    if (fields.length) {
      await tx.db.updateTable('reviews').set({
        selfAnswers: JSON.stringify(next.selfAnswers), managerAnswers: JSON.stringify(next.managerAnswers), rating: next.rating, status: next.status,
      }).where('id', '=', id).execute();
      await tx.audit('Updated', 'Review', id, fields.map((k) => ({ field: k, before: k === 'status' || k === 'rating' ? (r[k] as string | null) : null, after: k === 'status' || k === 'rating' ? (next[k] as string | null) : 'edited' })));
      if (changed('status') && next.status === 'Manager review' && r.reviewerId !== actor.employeeId) {
        await tx.notify({ recipientIds: [r.reviewerId], kind: 'System', text: `${actor.name} submitted their self-review`, href: '/app/people/performance/' + id });
      }
    }
    return next;
  });
}

/** GET /goals?employeeId */
export async function listGoals(actor: Actor, employeeId?: string): Promise<Goal[]> {
  if (!can(actor, 'performance', 'view')) return [];
  const ids = await visibleEmployeeIds(db, actor, 'performance');
  let q = db.selectFrom('goals').selectAll();
  if (ids) q = q.where('employeeId', 'in', ids.length ? ids : ['-']);
  if (employeeId) q = q.where('employeeId', '=', employeeId);
  const rows = await q.orderBy('employeeId').orderBy('id').execute();
  return rows.map((g) => ({ id: g.id, employeeId: g.employeeId, cycleId: g.cycleId, title: g.title, progress: g.progress, measure: g.measure }));
}
