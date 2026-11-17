/** Admin hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const A = () => import('./Admin');
const Users = lazy(() => A().then((m) => ({ default: m.Users })));
const Roles = lazy(() => A().then((m) => ({ default: m.Roles })));
const Workflows = lazy(() => A().then((m) => ({ default: m.Workflows })));
const WorkflowBuilder = lazy(() => A().then((m) => ({ default: m.WorkflowBuilder })));
const NotificationRules = lazy(() => A().then((m) => ({ default: m.NotificationRules })));
const Audit = lazy(() => A().then((m) => ({ default: m.Audit })));
const Masters = lazy(() => A().then((m) => ({ default: m.Masters })));

export default function AdminRoutes({ seg }: RouteProps) {
  const [, , a, b] = seg;
  if (!a) return <Hub hubKey="admin" />;
  if (a === 'users' && !b) return <Users />;
  if (a === 'roles' && !b) return <Roles />;
  if (a === 'workflows') return !b ? <Workflows /> : <WorkflowBuilder key={b} id={b} />;
  if (a === 'notifications' && !b) return <NotificationRules />;
  if (a === 'audit' && !b) return <Audit />;
  if (a === 'masters' && !b) return <Masters />;
  return <NotFound seg={seg} />;
}
