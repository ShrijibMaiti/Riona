/** Work hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';
import { ApprovalQueue } from '../../components/ApprovalQueue';

const Timesheets = lazy(() => import('./Timesheets'));
const WorkCalendar = lazy(() => import('./WorkCalendar'));
const P = () => import('./Projects');
const ProjectsList = lazy(() => P().then((m) => ({ default: m.ProjectsList })));
const ProjectDetail = lazy(() => P().then((m) => ({ default: m.ProjectDetail })));
const TaskPage = lazy(() => P().then((m) => ({ default: m.TaskPage })));

export default function WorkRoutes({ seg, query }: RouteProps) {
  const [, , a, b, c, d] = seg;
  if (!a) return <Hub hubKey="work" />;
  if (a === 'timesheets' && !b) return <Timesheets startTimer={query.get('timer') === 'start'} />;
  if (a === 'timesheets' && b === 'approvals') return <ApprovalQueue type="Timesheet" title="Timesheet approvals" desc="Employee-weeks waiting on you. Approved hours become billable." />;
  if (a === 'calendar' && !b) return <WorkCalendar />;
  if (a === 'projects') {
    if (!b) return <ProjectsList />;
    if (c === 'task' && d) return <TaskPage projectId={b} taskId={d} />;
    if (!d) return <ProjectDetail key={b} id={b} tab={c} taskId={query.get('task') ?? undefined} />;
  }
  return <NotFound seg={seg} />;
}
