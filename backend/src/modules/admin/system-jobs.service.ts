/**
 * Admin › System jobs: the last run of each background job. The scheduler records its own jobs here (recordRun);
 * jobs imported with the demo keep their history.
 */
import type { SystemJob } from '@riona/shared';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';

/** GET /system-jobs */
export async function listSystemJobs(actor: Actor): Promise<SystemJob[]> {
  authorize(actor, 'admin', 'view');
  const rows = await db.selectFrom('systemJobs').selectAll().orderBy('name').execute();
  return rows.map((j) => ({ id: j.id, name: j.name, lastRun: j.lastRun, status: j.status as SystemJob['status'], detail: j.detail }));
}

/**
 * Records a scheduler run. Frequent jobs don't write on every tick: a run is written when the status changes or
 * at most once a minute.
 */
const lastWritten = new Map<string, { at: number; status: string }>();
export async function recordRun(name: string, status: 'Succeeded' | 'Failed', detail: string) {
  const prev = lastWritten.get(name);
  if (prev && prev.status === status && Date.now() - prev.at < 60_000) return;
  lastWritten.set(name, { at: Date.now(), status });
  await db
    .insertInto('systemJobs')
    .values({ id: 'JOB-' + name, name, lastRun: new Date(), status, detail })
    .onConflict((oc) => oc.column('name').doUpdateSet({ lastRun: new Date(), status, detail }))
    .execute();
}
