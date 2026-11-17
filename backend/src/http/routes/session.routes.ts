/**
 * Session and auth: GET /me, POST /auth/login, POST /auth/logout, POST /auth/forgot, GET|POST /auth/reset/:token
 * (a password from an emailed link: reset or invitation), GET /auth/sso/:provider/start|callback (Google, Microsoft),
 * GET|POST /setup/:token, and POST /demo-requests.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate';
import { endSession, requireSession, startSession } from '../plugins/session';
import { getMe } from '../../modules/session/me.service';
import { checkResetToken, checkSetupToken, completeReset, completeSetup, requestPasswordReset, signIn } from '../../modules/session/auth.service';
import { DemoRequest, requestDemo } from '../../modules/public/demo.service';
import { db } from '../../db/client';
import { finishSso, PROVIDERS, startSso, type Provider } from '../../auth/sso';
import { notFound } from '../../lib/errors';

const Login = z.object({
  email: z.string().trim().email('Enter a valid work email.'),
  password: z.string().min(1, 'Enter your password.').max(500),
});
const Forgot = z.object({ email: z.string().trim().email('Enter a valid email.') });
const ResetPassword = z.object({ password: z.string({ required_error: 'Choose a password.' }).max(500) });
const Setup = z.object({
  orgName: z.string().trim().min(1, 'Enter the organisation’s name.').max(200),
  legalName: z.string().trim().max(200).default(''),
  state: z.string().trim().min(1, 'Choose a state.').max(60),
  gstin: z.string().trim().max(15).default(''),
  adminName: z.string().trim().min(1, 'Enter your name.').max(120),
  password: z.string().max(500),
  modules: z.array(z.string().max(40)).max(50).default([]),
});

const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get('/me', { onRequest: requireSession }, async (req) => getMe(req.actor!));

  app.post('/auth/login', async (req, reply) => {
    const { email, password } = parse(Login, req.body);
    const user = await signIn(email, password);
    await startSession(req, reply, user.id);
    return { ok: true as const, role: user.role };
  });

  // Idempotent: signing out without a session still answers 204 and clears the cookie.
  app.post('/auth/logout', async (req, reply) => {
    await endSession(req, reply);
    return reply.status(204).send();
  });

  app.post('/auth/forgot', async (req) => {
    const { email } = parse(Forgot, req.body);
    await requestPasswordReset(email, req.ip);
    return { ok: true as const };
  });

  app.get<{ Params: { token: string } }>('/auth/reset/:token', async (req) => checkResetToken(req.params.token));

  // Sets the password from an emailed link and signs the person in.
  app.post<{ Params: { token: string } }>('/auth/reset/:token', async (req, reply) => {
    const { password } = parse(ResetPassword, req.body);
    const userId = await completeReset(req.params.token, password, req.ip);
    await startSession(req, reply, userId);
    const user = await db.selectFrom('users').select('role').where('id', '=', userId).executeTakeFirstOrThrow();
    return { ok: true as const, role: user.role };
  });

  // Single sign-on: a full-page redirect to Google or Microsoft and back (auth/sso.ts).
  const provider = (p: string): Provider => {
    if (!PROVIDERS.includes(p as Provider)) throw notFound('Unknown sign-in provider.');
    return p as Provider;
  };
  app.get<{ Params: { provider: string } }>('/auth/sso/:provider/start', async (req, reply) => startSso(req, reply, provider(req.params.provider)));
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>('/auth/sso/:provider/callback', async (req, reply) =>
    finishSso(req, reply, provider(req.params.provider)));

  // "Book a demo" on the public site (no sign-in; rate-limited).
  app.post('/demo-requests', async (req) => requestDemo(parse(DemoRequest, req.body), req.ip));

  app.get<{ Params: { token: string } }>('/setup/:token', async (req) => checkSetupToken(req.params.token));

  app.post<{ Params: { token: string } }>('/setup/:token', async (req, reply) => {
    const userId = await completeSetup(req.params.token, parse(Setup, req.body), req.ip);
    await startSession(req, reply, userId);
    return { ok: true as const };
  });
};

export default sessionRoutes;
