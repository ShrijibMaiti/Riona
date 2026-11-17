import type { Task } from '../types';

/** Share of a project's tasks that are done, 0–100. The same measure the Projects list shows. */
export function projectProgress(tasks: Pick<Task, 'projectId' | 'status'>[], projectId: string): number {
  const ts = tasks.filter((t) => t.projectId === projectId);
  return ts.length ? Math.round((ts.filter((t) => t.status === 'done').length / ts.length) * 100) : 0;
}
