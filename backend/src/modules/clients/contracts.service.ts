/** Client contracts (MSA, SOW, NDA, AMC) with their SLA terms. Read with clients:view. */
import type { Contract } from '@riona/shared';
import { db } from '../../db/client';
import { authorize } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { toRupees } from '../../lib/money';

/** GET /contracts */
export async function listContracts(actor: Actor): Promise<Contract[]> {
  authorize(actor, 'clients', 'view');
  const rows = await db.selectFrom('contracts').selectAll().orderBy('clientId').orderBy('start').orderBy('id').execute();
  return rows.map((c) => ({
    id: c.id, clientId: c.clientId, title: c.title, kind: c.kind as Contract['kind'], start: c.start, end: c.end, value: toRupees(c.valuePaise),
    autoRenew: c.autoRenew, slaResponseHours: c.slaResponseHours, slaResolutionHours: c.slaResolutionHours, status: c.status as Contract['status'],
  }));
}
