/** The sales pipeline. Read with clients:view; moving a lead takes clients:edit. */
import type { Lead, LeadStage } from '@riona/shared';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import type { DB } from '../../db/schema';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { notFound } from '../../lib/errors';
import { today } from '../../lib/dates';
import { toRupees } from '../../lib/money';

type Q = Kysely<DB> | Transaction<DB>;
const STAGES = ['New', 'Qualified', 'Proposal sent', 'Negotiation', 'Won', 'Lost'] as const;
export const MoveLead = z.object({ stage: z.enum(STAGES, { errorMap: () => ({ message: 'Choose a stage.' }) }) });

async function loadLeads(q: Q, ids?: string[]): Promise<Lead[]> {
  let lq = q.selectFrom('leads').selectAll();
  if (ids) lq = lq.where('id', 'in', ids.length ? ids : ['-']);
  const rows = await lq.orderBy('created', 'desc').orderBy('id').execute();
  if (!rows.length) return [];
  const acts = await q.selectFrom('leadActivity').selectAll().where('leadId', 'in', rows.map((r) => r.id)).orderBy('id').execute();
  return rows.map((l) => ({
    id: l.id, company: l.company, contact: l.contact, value: toRupees(l.valuePaise), stage: l.stage as LeadStage, ownerId: l.ownerId, source: l.source,
    stageSince: l.stageSince, created: l.created, probability: l.probability, notes: l.notes,
    activity: acts.filter((a) => a.leadId === l.id).map((a) => ({ at: a.at, text: a.text, byId: a.byId })),
  }));
}

/** GET /leads */
export async function listLeads(actor: Actor) {
  authorize(actor, 'clients', 'view');
  return loadLeads(db);
}
/** GET /leads/:id */
export async function getLead(actor: Actor, id: string) {
  authorize(actor, 'clients', 'view');
  const [l] = await loadLeads(db, [id]);
  if (!l) throw notFound('Lead not found');
  return l;
}
/** PATCH /leads/:id { stage } — records the move on the lead's activity. */
export async function moveLead(actor: Actor, id: string, stage: LeadStage): Promise<Lead> {
  authorize(actor, 'clients', 'edit');
  const me = selfId(actor);
  return withTransaction(actor, async (tx) => {
    const row = await tx.db.selectFrom('leads').select(['stage']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw notFound('Lead not found');
    if (row.stage !== stage) {
      const on = today();
      await tx.db.updateTable('leads').set({ stage, stageSince: on }).where('id', '=', id).execute();
      await tx.db.insertInto('leadActivity').values({ leadId: id, at: on, text: 'Moved to ' + stage, byId: me }).execute();
      await tx.audit('Updated', 'Lead', id, [{ field: 'stage', before: row.stage, after: stage }]);
    }
    return (await loadLeads(tx.db, [id]))[0];
  });
}
