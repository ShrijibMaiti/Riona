import { useCallback } from 'react';
import { decideApproval, approveMany } from '../data/repositories';
import { invalidate } from '../lib/query';
import { useApp } from '../state/store';

/** Every domain an approval decision can change. */
export const APPROVAL_DOMAINS = ['approvals', 'leave', 'expenses', 'entries', 'weeks', 'attendance', 'invoices', 'notifications', 'audit', 'regularisations'];

/** Approve or reject, with a toast. Rejection requires a reason (enforced server-side too). */
export function useDecide() {
  const { say } = useApp();
  const decide = useCallback(
    async (id: string, approve: boolean, who: string, kind: string, comment?: string) => {
      try {
        const a = await decideApproval(id, approve, comment);
        invalidate(...APPROVAL_DOMAINS);
        const next = a.status === 'Pending' ? ' · sent to the next approver' : '';
        say((approve ? 'Approved' : 'Rejected') + ' · ' + who + '’s ' + kind.toLowerCase() + (kind === 'Leave' || kind === 'Expense' ? '' : ' request') + next);
        return true;
      } catch (e) {
        say((e as Error).message);
        return false;
      }
    },
    [say],
  );
  const approveAll = useCallback(
    async (ids: string[]) => {
      const n = await approveMany(ids);
      invalidate(...APPROVAL_DOMAINS);
      say('Approved ' + n + ' requests');
    },
    [say],
  );
  return { decide, approveAll };
}
