/**
 * Background jobs, started by main.ts (never in tests). Each job runs on an interval and never overlaps itself.
 * Each run is recorded on Admin › System jobs (modules/admin/system-jobs.service.ts).
 */
import type { FastifyBaseLogger } from 'fastify';
import { dispatchOnce, setDispatcherLogger } from '../engines/notifications/dispatcher.job';
import { markOverdue } from '../modules/finance/invoices.service';
import { recordRun } from '../modules/admin/system-jobs.service';
import { runApprovalTimeouts } from '../engines/approvals/timeouts.job';

export type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

const JOBS: Job[] = [
  // The outbox is also kicked right after each commit; this catches retries and anything missed on restart.
  { name: 'Notification delivery', everyMs: 5_000, run: () => dispatchOnce() },
  // Issued invoices past their due date become Overdue. Hourly is plenty; it is cheap and idempotent.
  { name: 'Overdue invoices', everyMs: 3_600_000, run: markOverdue },
  // Approval SLAs: remind the approver, or approve automatically where the workflow says so.
  { name: 'Approval timeouts', everyMs: 15 * 60_000, run: async () => { const r = await runApprovalTimeouts(); return r.approved + r.reminded; } },
];

export function registerJob(job: Job) {
  JOBS.push(job);
}

/** Starts every job; returns a function that stops them. */
export function startScheduler(log: FastifyBaseLogger) {
  setDispatcherLogger(log);
  const timers = JOBS.map((job) => {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const out = await job.run();
        await recordRun(job.name, 'Succeeded', typeof out === 'number' ? `${out} updated` : '').catch(() => {});
      } catch (err) {
        log.error({ err }, `Job ${job.name} failed`);
        await recordRun(job.name, 'Failed', (err as Error).message.slice(0, 300)).catch(() => {});
      } finally {
        busy = false;
      }
    };
    void tick();
    return setInterval(tick, job.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
