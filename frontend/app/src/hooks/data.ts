/**
 * Shared data hooks. Screens use these (or useQuery with a repository function) — never the seed.
 * Query keys start with the domain name so mutations can invalidate by domain.
 */

import * as api from '../data/repositories';
import { useQuery, type QueryKey } from '../lib/query';
import { useApp } from '../state/store';

const FROM = '2025-11-01';

export const useMe = () => useQuery(['session', 'me'], api.getMe);
export const useEmployees = () => useQuery(['employees', 'all'], () => api.getEmployees({ pageSize: 1000 }).then((p) => p.items));
export const useClients = () => useQuery(['clients'], api.getClients);
export const useProjects = () => useQuery(['projects', 'all'], () => api.getProjects({ pageSize: 1000 }).then((p) => p.items));
export const useApprovals = () => useQuery(['approvals', 'all'], () => api.getApprovals());
export const useNotifications = () => useQuery(['notifications'], api.getNotifications);
export const useAllEntries = () => useQuery(['entries', 'all'], () => api.getTimesheetEntries());
export const useAllInvoices = () => useQuery(['invoices', 'all'], () => api.getInvoices({ pageSize: 1000 }).then((p) => p.items));
export const useAllExpenses = () => useQuery(['expenses', 'all'], () => api.getExpenses({ pageSize: 1000 }).then((p) => p.items));
export const useAllSalaryEvents = () => useQuery(['salary', 'all'], api.getAllSalaryEvents);
export const useAllAttendance = (today?: string) => useQuery(['attendance', 'all', today], () => api.getAttendance({ from: FROM, to: today! }), { enabled: !!today });
export const useLeave = () => useQuery(['leave', 'all'], () => api.getLeaveRequests());
export const useLeaveTypes = () => useQuery(['leaveTypes'], api.getLeaveTypes);
export const useTasks = () => useQuery(['tasks', 'all'], () => api.getTasks());

/**
 * A list only some roles may read (the API answers 403 to the rest): for them it is simply empty, without asking.
 * The key differs, so a role switch in the in-memory build never reuses the other role's answer.
 */
export function useAllowedList<T>(ok: boolean, key: QueryKey, fn: () => Promise<T[]>) {
  return useQuery<T[]>(ok ? key : [...key, 'not-allowed'], ok ? fn : () => Promise.resolve([]));
}
export const canSeeUsers = (role: string) => role === 'Admin';
export const canSeeAudit = (role: string) => role === 'Admin' || role === 'HR';

/**
 * The figures, hub attention lists and dashboard list, computed by the server over what the signed-in person may
 * see (GET /dashboard-facts). Cached under 'facts', which every change marks stale (lib/query.ts).
 */
export const useFacts = () => {
  const { role } = useApp();
  return useQuery(['facts', 'dashboard', role], () => api.getDashboardFacts(role));
};
