/**
 * Builds the Fastify app: logging, request ids, cookies, the error contract, and the API routes under
 * config.apiPrefix. Kept separate from main.ts so tests can build an app without opening a port:
 *
 *   const app = await buildApp(); const res = await app.inject({ url: '/api/v1/health' });
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config';
import { pingDb } from './db/client';
import errors from './http/plugins/errors';
import session from './http/plugins/session';
import csrf from './http/plugins/csrf';
import sessionRoutes from './http/routes/session.routes';
import peopleRoutes from './http/routes/people.routes';
import workRoutes from './http/routes/work.routes';
import approvalsRoutes from './http/routes/approvals.routes';
import adminRoutes from './http/routes/admin.routes';
import payrollRoutes from './http/routes/payroll.routes';
import financeRoutes from './http/routes/finance.routes';
import clientsRoutes from './http/routes/clients.routes';
import portalRoutes from './http/routes/portal.routes';
import webhooksRoutes from './http/routes/webhooks.routes';
import workplaceRoutes from './http/routes/workplace.routes';
import talentRoutes from './http/routes/talent.routes';
import uploadsRoutes from './http/routes/uploads.routes';
import dashboardRoutes from './http/routes/dashboard.routes';
import portalScope from './http/plugins/portal-scope';
import { registerApprovalOutcomes } from './engines/approvals/register';

const VERSION = process.env.npm_package_version ?? '0.1.0';

export async function buildApp(): Promise<FastifyInstance> {
  // What each kind of request does when it is decided (engines/approvals).
  registerApprovalOutcomes();

  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.logLevel,
          // Never log credentials or session cookies.
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password'],
          ...(config.isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
        },
    // Behind the Vite proxy in development and a load balancer in production.
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024, // 1 MB of JSON. Files go through signed uploads (Wave 8), not request bodies.
    routerOptions: { caseSensitive: true, ignoreTrailingSlash: true },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    if (req.url.startsWith(config.apiPrefix)) reply.header('Cache-Control', 'no-store');
  });

  await app.register(cookie, { secret: config.session.secret, hook: 'onRequest' });
  await app.register(errors);
  // Who is asking (req.actor, from the session cookie), then CSRF on every state-changing request.
  await app.register(session);
  // Client accounts reach /portal only; /portal is for client accounts only.
  await app.register(portalScope);
  await app.register(csrf);

  await app.register(
    async (api) => {
      // Liveness and readiness. 503 when the database is down, so a load balancer stops sending traffic.
      api.get('/health', async (_req, reply) => {
        const dbUp = await pingDb();
        return reply.status(dbUp ? 200 : 503).send({
          status: dbUp ? 'ok' : 'degraded',
          db: dbUp ? 'up' : 'down',
          time: new Date().toISOString(),
          timeZone: config.timeZone,
          version: VERSION,
        });
      });

      await api.register(sessionRoutes);
      await api.register(peopleRoutes);
      await api.register(workRoutes);
      await api.register(approvalsRoutes);
      await api.register(adminRoutes);
      await api.register(payrollRoutes);
      await api.register(financeRoutes);
      await api.register(clientsRoutes);
      await api.register(portalRoutes);
      await api.register(webhooksRoutes);
      await api.register(workplaceRoutes);
      await api.register(talentRoutes);
      await api.register(uploadsRoutes);
      await api.register(dashboardRoutes);
      // Later waves register their route groups here.
    },
    { prefix: config.apiPrefix },
  );

  return app;
}
