/**
 * The client portal's API (/portal/*). The portal-scope plugin has already checked that a client account is
 * signed in; each handler reads through that client's database scope (modules/portal/portal.service.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../../lib/validate';
import {
  getPortalDocumentUrl, getPortalDocuments, getPortalInvoice, getPortalInvoices, getPortalProject, getPortalProjects, getPortalSession,
  getPortalTicket, getPortalTickets, PayInvoice, payPortalInvoice, RaiseTicket, raisePortalTicket, ReplyTicket, replyPortalTicket,
} from '../../modules/portal/portal.service';

type Id = { Params: { id: string } };

const portalRoutes: FastifyPluginAsync = async (app) => {
  app.get('/portal/session', async (req) => getPortalSession(req.actor!));

  app.get('/portal/projects', async (req) => getPortalProjects(req.actor!));
  app.get<Id>('/portal/projects/:id', async (req) => getPortalProject(req.actor!, req.params.id));

  app.get('/portal/invoices', async (req) => getPortalInvoices(req.actor!));
  app.get<Id>('/portal/invoices/:id', async (req) => getPortalInvoice(req.actor!, req.params.id));
  app.post<Id>('/portal/invoices/:id/pay', async (req) => payPortalInvoice(req.actor!, req.params.id, parse(PayInvoice, req.body).method));

  app.get('/portal/tickets', async (req) => getPortalTickets(req.actor!));
  app.get<Id>('/portal/tickets/:id', async (req) => getPortalTicket(req.actor!, req.params.id));
  app.post('/portal/tickets', async (req) => raisePortalTicket(req.actor!, parse(RaiseTicket, req.body)));
  app.post<Id>('/portal/tickets/:id/messages', async (req) => replyPortalTicket(req.actor!, req.params.id, parse(ReplyTicket, req.body).text));

  app.get('/portal/documents', async (req) => getPortalDocuments(req.actor!));
  app.get<Id>('/portal/documents/:id/download', async (req) => getPortalDocumentUrl(req.actor!, req.params.id));
};

export default portalRoutes;
