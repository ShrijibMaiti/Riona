/** Admin: approval workflows, users, roles, notification rules, the audit log, master lists and system jobs. */
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { getWorkflow, listWorkflows, saveWorkflow, WorkflowInput } from '../../modules/admin/workflows.service';
import { InviteUser, inviteUser, listUsers, resendInvite, UpdateUser, updateUser } from '../../modules/admin/users.service';
import { listRoles, SetPermission, setPermission } from '../../modules/admin/roles.service';
import { listRules, SetChannel, setChannel } from '../../modules/admin/notification-rules.service';
import { AuditQuery, listAudit } from '../../modules/admin/audit-read.service';
import { listMasters, MasterRow, saveMasterRow } from '../../modules/admin/masters.service';
import { listSystemJobs } from '../../modules/admin/system-jobs.service';

type Id = { Params: { id: string } };

const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/workflows', async (req) => listWorkflows(req.actor!));
  app.get<Id>('/workflows/:id', async (req) => getWorkflow(req.actor!, req.params.id));
  app.put<Id>('/workflows/:id', async (req) => saveWorkflow(req.actor!, req.params.id, parse(WorkflowInput, req.body)));

  app.get('/users', async (req) => listUsers(req.actor!));
  app.post('/users/invite', async (req) => inviteUser(req.actor!, parse(InviteUser, req.body)));
  app.patch<Id>('/users/:id', async (req) => updateUser(req.actor!, req.params.id, parse(UpdateUser, req.body)));
  app.post<Id>('/users/:id/invite', async (req) => resendInvite(req.actor!, req.params.id));

  app.get('/roles', async (req) => listRoles(req.actor!));
  app.put<{ Params: { id: string; module: string } }>('/roles/:id/permissions/:module', async (req) =>
    setPermission(req.actor!, req.params.id, req.params.module, parse(SetPermission, req.body).permission));

  app.get('/notification-rules', async (req) => listRules(req.actor!));
  app.patch<Id>('/notification-rules/:id', async (req) => {
    const b = parse(SetChannel, req.body);
    return setChannel(req.actor!, req.params.id, b.channel, b.on);
  });

  app.get('/audit', async (req) => listAudit(req.actor!, parse(AuditQuery, req.query)));

  app.get('/masters', async (req) => listMasters(req.actor!));
  app.put<{ Params: { id: string; rowId: string } }>('/masters/:id/rows/:rowId', async (req) => saveMasterRow(req.actor!, req.params.id, req.params.rowId, parse(MasterRow, req.body)));
  app.post<Id>('/masters/:id/rows', async (req) => saveMasterRow(req.actor!, req.params.id, undefined, parse(MasterRow, req.body)));

  app.get('/system-jobs', async (req) => listSystemJobs(req.actor!));
};

export default adminRoutes;
