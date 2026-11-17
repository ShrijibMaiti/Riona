/** Clients hub: leads, contracts, support tickets (shared with the client portal) and documents. */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { unprocessable } from '../../lib/errors';
import { getTicket, listTickets, replyToTicket, setTicketStatus, TicketReply, TicketStatus } from '../../modules/clients/tickets.service';
import { getLead, listLeads, MoveLead, moveLead } from '../../modules/clients/leads.service';
import { listContracts } from '../../modules/clients/contracts.service';
import { DocumentsQuery, documentUrl, listDocuments, NewVersion, uploadVersion } from '../../modules/clients/documents.service';

type Id = { Params: { id: string } };

const clientsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/tickets', async (req) => listTickets(req.actor!, parse(z.object({ clientId: z.string().max(40).optional() }), req.query).clientId));
  app.get<Id>('/tickets/:id', async (req) => getTicket(req.actor!, req.params.id));
  app.post<Id>('/tickets/:id/messages', async (req) => {
    const b = parse(TicketReply, req.body);
    return replyToTicket(req.actor!, req.params.id, b.text, b.internal);
  });
  app.patch<Id>('/tickets/:id', async (req) => setTicketStatus(req.actor!, req.params.id, parse(TicketStatus, req.body).status));

  app.get('/leads', async (req) => listLeads(req.actor!));
  app.get<Id>('/leads/:id', async (req) => getLead(req.actor!, req.params.id));
  app.patch<Id>('/leads/:id', async (req) => moveLead(req.actor!, req.params.id, parse(MoveLead, req.body).stage));
  app.get('/contracts', async (req) => listContracts(req.actor!));

  app.get('/documents', async (req) => {
    const q = parse(DocumentsQuery, req.query);
    return listDocuments(req.actor!, q.ownerType, q.ownerId || undefined);
  });
  app.post<Id>('/documents/:id/versions', async (req) => {
    const b = parse(NewVersion, req.body);
    return uploadVersion(req.actor!, req.params.id, b.note, b.fileId);
  });
  app.get<{ Params: { id: string; version: string } }>('/documents/:id/versions/:version/download', async (req) => {
    const v = req.params.version === 'latest' ? undefined : Number(req.params.version);
    if (v !== undefined && !(Number.isInteger(v) && v > 0)) throw unprocessable('Choose a version.', { version: 'Invalid' });
    return documentUrl(req.actor!, req.params.id, v);
  });
};

export default clientsRoutes;
