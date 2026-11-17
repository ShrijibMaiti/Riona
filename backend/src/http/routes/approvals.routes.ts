/** The consolidated approval queue (/approvals, decisions, bulk decisions) and the bell (/notifications). */
import type { Notification } from '@riona/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/session';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { selfId } from '../../auth/rbac/authorize';
import { approveMany, decide, listApprovals } from '../../engines/approvals/engine';
import { opt, parse } from '../../lib/validate';

const TYPES = ['Leave', 'Expense', 'Timesheet', 'Regularisation', 'Invoice', 'Profile change'] as const;
const Filter = z.object({
  type: opt(z.enum(TYPES)),
  status: opt(z.enum(['Pending', 'Approved', 'Rejected'])),
  approverId: opt(z.string().max(40)),
  requesterId: opt(z.string().max(40)),
});
const Decision = z.object({ approve: z.boolean({ required_error: 'Approve or reject.' }), comment: z.string().max(2000).nullable().optional() });
const Bulk = z.object({ ids: z.array(z.string().max(40)).min(1, 'Choose at least one request.').max(500), approve: z.literal(true, { errorMap: () => ({ message: 'Bulk decisions can only approve.' }) }) });

const approvalsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/approvals', async (req) => listApprovals(req.actor!, parse(Filter, req.query)));

  app.post<{ Params: { id: string } }>('/approvals/:id/decision', async (req) => {
    const { approve, comment } = parse(Decision, req.body);
    return decide(req.actor!, req.params.id, approve, comment);
  });

  app.post('/approvals/bulk-decision', async (req) => approveMany(req.actor!, parse(Bulk, req.body).ids));

  app.get('/notifications', async (req): Promise<Notification[]> => {
    const me = selfId(req.actor!);
    const rows = await db.selectFrom('notifications').selectAll().where('recipientId', '=', me).orderBy('at', 'desc').orderBy('id', 'desc').limit(200).execute();
    return rows.map((n) => ({ id: n.id, at: n.at, kind: n.kind as Notification['kind'], text: n.text, href: n.href, approvalId: n.approvalId, actorId: n.actorId, recipientId: n.recipientId, read: n.read }));
  });

  app.post('/notifications/read-all', async (req, reply) => {
    const me = selfId(req.actor!);
    await withTransaction(req.actor!, (tx) => tx.db.updateTable('notifications').set({ read: true }).where('recipientId', '=', me).where('read', '=', false).execute());
    return reply.status(204).send();
  });
};

export default approvalsRoutes;
