/** Workplace: assets, stock, rooms and bookings, announcements, the knowledge base and visitors. */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../plugins/session';
import { F, opt, parse } from '../../lib/validate';
import { allocateAsset, Allocate, AssetIssue, getAsset, listAssets, myAssets, reportAssetIssue } from '../../modules/workplace/assets.service';
import { listInventory, Movement, moveStock } from '../../modules/workplace/inventory.service';
import { createBooking, listBookings, listRooms, NewBooking } from '../../modules/workplace/rooms.service';
import { acknowledge, listAnnouncements } from '../../modules/workplace/announcements.service';
import { getKbArticle, listKb } from '../../modules/workplace/kb.service';
import { checkVisitor, listVisitors, NewVisitor, registerVisitor } from '../../modules/workplace/visitors.service';
import { today } from '../../lib/dates';

type Id = { Params: { id: string } };

const workplaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get('/assets', async (req) => listAssets(req.actor!));
  app.get('/me/assets', async (req) => myAssets(req.actor!));
  app.get<Id>('/assets/:id', async (req) => getAsset(req.actor!, req.params.id));
  app.post<Id>('/assets/:id/issues', async (req) => reportAssetIssue(req.actor!, req.params.id, parse(AssetIssue, req.body).text));
  app.post<Id>('/assets/:id/allocate', async (req) => {
    const b = parse(Allocate, req.body);
    return allocateAsset(req.actor!, req.params.id, b.employeeId, b.note);
  });

  app.get('/inventory', async (req) => listInventory(req.actor!));
  app.post<Id>('/inventory/:id/movements', async (req) => moveStock(req.actor!, req.params.id, parse(Movement, req.body)));

  app.get('/rooms', async (req) => listRooms(req.actor!));
  app.get('/bookings', async (req) => listBookings(req.actor!, parse(z.object({ date: opt(F.date) }), req.query).date ?? today()));
  app.post('/bookings', async (req) => createBooking(req.actor!, parse(NewBooking, req.body)));

  app.get('/announcements', async (req) => listAnnouncements(req.actor!));
  app.post<Id>('/announcements/:id/acknowledge', async (req) => acknowledge(req.actor!, req.params.id));

  app.get('/kb', async (req) => listKb(req.actor!));
  app.get<{ Params: { slug: string } }>('/kb/:slug', async (req) => getKbArticle(req.actor!, req.params.slug));

  app.get('/visitors', async (req) => listVisitors(req.actor!, parse(z.object({ date: opt(F.date) }), req.query).date));
  app.post('/visitors', async (req) => {
    const b = parse(NewVisitor, req.body);
    return registerVisitor(req.actor!, b);
  });
  app.post<Id>('/visitors/:id/check-in', async (req) => checkVisitor(req.actor!, req.params.id, 'in'));
  app.post<Id>('/visitors/:id/check-out', async (req) => checkVisitor(req.actor!, req.params.id, 'out'));
};

export default workplaceRoutes;
