/** Dashboards and hubs: the figures, attention lists and analytics blocks, computed server-side. */
import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../plugins/session';
import { parse } from '../../lib/validate';
import { BlocksQuery, FactsQuery, getDashboardBlocks, getDashboardFacts } from '../../modules/dashboard/facts.service';

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', requireSession);
  app.get('/dashboard-facts', async (req) => getDashboardFacts(req.actor!, parse(FactsQuery, req.query)));
  app.get('/dashboard-blocks', async (req) => getDashboardBlocks(req.actor!, parse(BlocksQuery, req.query)));
};

export default dashboardRoutes;
