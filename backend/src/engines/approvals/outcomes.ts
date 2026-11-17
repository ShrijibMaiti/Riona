/**
 * What each kind of request does with the engine. A module registers a handler for its type (see register.ts):
 *   loadSources  the records behind a set of approvals, as the queue embeds them
 *   apply        the final decision written onto the record (leave approved, attendance corrected …), inside the
 *                deciding transaction, so the decision and its effect commit together
 * The engine knows nothing about leave or timesheets; the modules know nothing about chains or approvers.
 */
import type { ApprovalSource } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/schema';
import type { Tx } from '../../db/tx';
import type { ApprovalType } from './resolvers';

export type DecidedApproval = { id: string; type: ApprovalType; sourceId: string; requesterId: string; status: 'Approved' | 'Rejected' };

export type OutcomeHandler = {
  loadSources: (q: Kysely<DB> | Transaction<DB>, sourceIds: string[]) => Promise<Map<string, ApprovalSource>>;
  apply: (tx: Tx, approval: DecidedApproval, comment: string | null) => Promise<void>;
};

const handlers = new Map<ApprovalType, OutcomeHandler>();

export function registerOutcome(type: ApprovalType, handler: OutcomeHandler) {
  handlers.set(type, handler);
}

/** The types the backend owns (registered). Others are served elsewhere (the mock, until their wave). */
export const ownedTypes = () => [...handlers.keys()];

export function handlerFor(type: string): OutcomeHandler {
  const h = handlers.get(type as ApprovalType);
  if (!h) throw new Error(`No approval outcome registered for ${type}`);
  return h;
}
