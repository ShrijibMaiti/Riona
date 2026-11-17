/** My Space routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const M = () => import('./MySpace');
const F = () => import('../finance/FinanceScreens');
const MyPayslips = lazy(() => import('./Payslips').then((m) => ({ default: m.MyPayslips })));
const MyLeave = lazy(() => M().then((m) => ({ default: m.MyLeave })));
const ApplyLeave = lazy(() => M().then((m) => ({ default: m.ApplyLeave })));
const MyAttendance = lazy(() => M().then((m) => ({ default: m.MyAttendance })));
const Regularise = lazy(() => M().then((m) => ({ default: m.Regularise })));
const MyExpenses = lazy(() => M().then((m) => ({ default: m.MyExpenses })));
const MyTasks = lazy(() => M().then((m) => ({ default: m.MyTasks })));
const MyAssets = lazy(() => M().then((m) => ({ default: m.MyAssets })));
const MyProfile = lazy(() => M().then((m) => ({ default: m.MyProfile })));
const RequestProfileChange = lazy(() => M().then((m) => ({ default: m.RequestProfileChange })));
const SubmitExpense = lazy(() => F().then((m) => ({ default: m.SubmitExpense })));
const ExpenseDetail = lazy(() => F().then((m) => ({ default: m.ExpenseDetail })));

export default function MeRoutes({ seg, query }: RouteProps) {
  const [, , a, b, c] = seg;
  if (!a) return <Hub hubKey="me" />;
  if (a === 'payslips' && !b) return <MyPayslips query={query} />;
  if (a === 'leave' && !b) return <MyLeave />;
  if (a === 'leave' && b === 'apply') return <ApplyLeave />;
  if (a === 'attendance' && !b) return <MyAttendance />;
  if (a === 'attendance' && b === 'regularise' && c) return <Regularise key={c} date={c} />;
  if (a === 'expenses' && !b) return <MyExpenses />;
  if (a === 'expenses' && b === 'new') return <SubmitExpense back="/app/me/expenses" />;
  if (a === 'expenses' && b) return <ExpenseDetail key={b} id={b} />;
  if (a === 'tasks' && !b) return <MyTasks />;
  if (a === 'assets' && !b) return <MyAssets />;
  if (a === 'profile' && !b) return <MyProfile />;
  if (a === 'profile' && b === 'change' && c) return <RequestProfileChange key={c} field={c} />;
  return <NotFound seg={seg} />;
}
