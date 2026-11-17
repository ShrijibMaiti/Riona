/** People hub routes — loaded as one lazy chunk. */
import { lazy } from 'react';
import Hub from '../Hub';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

const Directory = lazy(() => import('./Directory'));
const Profile = lazy(() => import('./Profile'));
const EmployeeForm = lazy(() => import('./EmployeeForm'));
const OrgChart = lazy(() => import('./OrgChart'));
const A = () => import('./Attendance');
const DailyLog = lazy(() => A().then((m) => ({ default: m.DailyLog })));
const Register = lazy(() => A().then((m) => ({ default: m.Register })));
const RegularisationQueue = lazy(() => A().then((m) => ({ default: m.RegularisationQueue })));
const L = () => import('./Leave');
const LeaveRequests = lazy(() => L().then((m) => ({ default: m.LeaveRequests })));
const LeaveCalendar = lazy(() => L().then((m) => ({ default: m.LeaveCalendar })));
const LeaveBalances = lazy(() => L().then((m) => ({ default: m.LeaveBalances })));
const LeavePolicies = lazy(() => L().then((m) => ({ default: m.LeavePolicies })));
const P = () => import('./Payroll');
const PayrollRuns = lazy(() => P().then((m) => ({ default: m.PayrollRuns })));
const PayrollRunScreen = lazy(() => P().then((m) => ({ default: m.PayrollRunScreen })));
const Structures = lazy(() => P().then((m) => ({ default: m.Structures })));
const Statutory = lazy(() => P().then((m) => ({ default: m.Statutory })));
const O = () => import('./PeopleOps');
const Onboarding = lazy(() => O().then((m) => ({ default: m.Onboarding })));
const OnboardingCaseScreen = lazy(() => O().then((m) => ({ default: m.OnboardingCaseScreen })));
const Performance = lazy(() => O().then((m) => ({ default: m.Performance })));
const ReviewForm = lazy(() => O().then((m) => ({ default: m.ReviewForm })));
const Recruitment = lazy(() => O().then((m) => ({ default: m.Recruitment })));
const JobPipeline = lazy(() => O().then((m) => ({ default: m.JobPipeline })));
const CandidateView = lazy(() => O().then((m) => ({ default: m.CandidateView })));
const Training = lazy(() => O().then((m) => ({ default: m.Training })));

export default function PeopleRoutes({ seg }: RouteProps) {
  const [, , a, b, c, d] = seg;
  if (!a) return <Hub hubKey="people" />;
  if (a === 'directory') {
    if (!b) return <Directory />;
    if (b === 'new') return <EmployeeForm />;
    if (c === 'edit') return <EmployeeForm id={b} />;
    if (!d) return <Profile id={b} tab={c} />;
  }
  if (a === 'org-chart' && !b) return <OrgChart />;
  if (a === 'attendance') {
    if (!b) return <DailyLog />;
    if (b === 'register') return <Register />;
    if (b === 'regularisation') return <RegularisationQueue />;
  }
  if (a === 'leave') {
    if (!b) return <Hub hubKey="leave" />;
    if (b === 'requests') return <LeaveRequests />;
    if (b === 'calendar') return <LeaveCalendar />;
    if (b === 'balances') return <LeaveBalances />;
    if (b === 'policies') return <LeavePolicies />;
  }
  if (a === 'payroll') {
    if (!b) return <PayrollRuns />;
    if (b === 'runs' && c) return <PayrollRunScreen id={c} />;
    if (b === 'runs') return <PayrollRuns />;
    if (b === 'structures') return <Structures />;
    if (b === 'statutory') return <Statutory />;
  }
  if (a === 'onboarding') {
    if (!b) return <Onboarding />;
    if (b === 'board') return <Onboarding board />;
    return <OnboardingCaseScreen id={b} />;
  }
  if (a === 'performance') {
    if (!b) return <Performance />;
    if (b === 'reviews' && c) return <ReviewForm id={c} />;
  }
  if (a === 'recruitment') {
    if (!b) return <Recruitment />;
    if (b === 'jobs' && c) return <JobPipeline id={c} />;
    if (b === 'candidates' && c) return <CandidateView id={c} />;
  }
  if (a === 'training' && !b) return <Training />;
  return <NotFound seg={seg} />;
}
