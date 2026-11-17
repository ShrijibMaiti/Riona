/**
 * CSRF protection for the cookie session. Every state-changing API request must carry
 * `X-Requested-With: riona`, a header a cross-site form can't set and a cross-site fetch can't send without a
 * CORS preflight the API never grants. If the browser sends an Origin, it must be the app's own.
 * Webhooks (Wave 7) are exempt: they authenticate by signature instead.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ErrorCodes } from '@riona/shared';
import { config } from '../../config';
import { forbidden } from '../../lib/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const csrfPlugin: FastifyPluginAsync = async (app) => {
  const allowed = new Set([config.appOrigin, ...config.extraOrigins].map((o) => new URL(o).origin));
  app.addHook('onRequest', async (req) => {
    if (SAFE.has(req.method) || !req.url.startsWith(config.apiPrefix + '/')) return;
    if (req.url.startsWith(config.apiPrefix + '/webhooks/')) return;
    if (req.headers['x-requested-with'] !== 'riona') throw forbidden('This request was blocked. Reload the page and try again.', ErrorCodes.CSRF);
    // Same-origin requests pass: the app's configured origins, or an Origin matching the host the browser
    // addressed (behind the Vite proxy or a load balancer, that is X-Forwarded-Host).
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      const fwd = req.headers['x-forwarded-host'];
      const host = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() ?? req.headers.host;
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        /* malformed Origin: blocked below */
      }
      if (!host || originHost !== host) throw forbidden('This request was blocked. Reload the page and try again.', ErrorCodes.CSRF);
    }
  });
};

export default fp(csrfPlugin, { name: 'riona-csrf', fastify: '5.x' });