/**
 * Who may do what, by module. One matrix, enforced on the server; the UI hides what a role can't use, but
 * hiding controls nothing. Levels are ordered: none < view < edit < approve.
 *
 * `scope` (auth/rbac/scope.ts) then narrows *which records* a permitted role sees: own, team or all.
 */
import type { AppRole } from '../../db/schema';

export type Level = 'none' | 'view' | 'edit' | 'approve';
export const LEVELS: Level[] = ['none', 'view', 'edit', 'approve'];

export type Module =
  | 'directory' | 'employees' | 'attendance' | 'leave' | 'payroll' | 'salary'
  | 'projects' | 'tasks' | 'timesheets' | 'clients'
  | 'finance' | 'expenses'
  | 'recruitment' | 'performance' | 'training' | 'workplace'
  | 'approvals' | 'workflows' | 'audit' | 'admin';

/**
 * - directory: names, titles, reporting lines (everyone)
 * - employees: the full HR record (personal details, bank, PAN)
 * - salary: the salary ledger and payslips of other people
 * - finance: invoices, payments and budgets; at `approve`, also profitability (cost rates derive from salaries)
 * - expenses: expense claims (scoped: own, team, all)
 * - recruitment: jobs, candidates, joining and leaving checklists
 * - performance: reviews and goals (scoped: own, team, all; a reviewer also sees the reviews they write)
 * - training: certifications (scoped); the programme catalogue is open to all staff
 * - workplace: the asset register and stock. Everyone sees what they hold; rooms, announcements, the knowledge
 *   base and visitors are open to all staff. Users whose role is named "IT" manage assets and stock.
 */
export const MATRIX: Record<Exclude<AppRole, 'Client'>, Record<Module, Level>> = {
  Admin: {
    directory: 'view', employees: 'edit', attendance: 'approve', leave: 'approve', payroll: 'approve', salary: 'edit',
    projects: 'edit', tasks: 'edit', timesheets: 'approve', clients: 'edit',
    finance: 'approve', expenses: 'approve',
    recruitment: 'edit', performance: 'edit', training: 'edit', workplace: 'edit',
    approvals: 'approve', workflows: 'edit', audit: 'view', admin: 'edit',
  },
  HR: {
    directory: 'view', employees: 'edit', attendance: 'approve', leave: 'approve', payroll: 'approve', salary: 'edit',
    projects: 'view', tasks: 'edit', timesheets: 'view', clients: 'view',
    finance: 'none', expenses: 'view',
    recruitment: 'edit', performance: 'edit', training: 'edit', workplace: 'view',
    approvals: 'approve', workflows: 'view', audit: 'view', admin: 'none',
  },
  Manager: {
    directory: 'view', employees: 'view', attendance: 'approve', leave: 'approve', payroll: 'none', salary: 'none',
    projects: 'edit', tasks: 'edit', timesheets: 'approve', clients: 'edit',
    // Managers see invoices; margin (salary-derived) stays with Admin.
    finance: 'view', expenses: 'approve',
    // Hiring managers follow their openings; managers review their team.
    recruitment: 'view', performance: 'edit', training: 'view', workplace: 'view',
    approvals: 'approve', workflows: 'view', audit: 'none', admin: 'none',
  },
  Employee: {
    directory: 'view', employees: 'view', attendance: 'view', leave: 'view', payroll: 'none', salary: 'none',
    projects: 'view', tasks: 'edit', timesheets: 'edit', clients: 'view',
    finance: 'none', expenses: 'edit',
    recruitment: 'none', performance: 'edit', training: 'view', workplace: 'none',
    // Workflow definitions say who approves what; no personal data. The dashboard reads them.
    approvals: 'view', workflows: 'view', audit: 'none', admin: 'none',
  },
};

/** Extra access by role *name* (Admin › Users): the IT team runs the asset register and stock. */
const BY_ROLE_NAME: Record<string, Partial<Record<Module, Level>>> = {
  IT: { workplace: 'edit' },
};

export function levelOf(role: AppRole, module: Module, roleName?: string): Level {
  if (role === 'Client') return 'none'; // portal users go through /portal/* only (Wave 7)
  const base = MATRIX[role][module];
  const extra = roleName ? BY_ROLE_NAME[roleName]?.[module] : undefined;
  return extra && LEVELS.indexOf(extra) > LEVELS.indexOf(base) ? extra : base;
}

export const atLeast = (have: Level, need: Level) => LEVELS.indexOf(have) >= LEVELS.indexOf(need);