/** Consolidated approvals — every module, one queue. */
import { ApprovalQueue } from '../../components/ApprovalQueue';
import { NotFound } from '../NotFound';
import type { RouteProps } from '../../routes';

export default function ApprovalsRoutes({ seg }: RouteProps) {
  if (seg.length === 2) return <ApprovalQueue type="All" title="Approvals" desc="Everything waiting on you, across every module, in one list." />;
  return <NotFound seg={seg} />;
}
