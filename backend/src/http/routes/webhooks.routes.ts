/**
 * Webhooks from outside services. No session and no CSRF header (csrf.ts exempts /webhooks/): each one is
 * authenticated by its signature instead.
 *
 * POST /webhooks/payments — the payment gateway confirms or declines a portal payment.
 *   Header  X-Riona-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with PAYMENT_WEBHOOK_SECRET>
 *   Body    { intentId, status: "captured" | "failed", reference, amount?: paise }
 * Answers 200 for a settled or already-settled intent (so the gateway stops retrying), 401 for a bad signature,
 * 404 for an unknown intent, 503 when no secret is configured.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { ApiError, notFound, unavailable } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { settleIntent } from '../../modules/portal/payments';

const Payload = z.object({
  intentId: z.string().min(1).max(60),
  status: z.enum(['captured', 'failed']),
  reference: z.string().min(1).max(120),
  amount: z.number().int().positive().optional(),
});

export const signPayload = (raw: string, secret: string) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

function verified(raw: Buffer, header: unknown, secret: string) {
  if (typeof header !== 'string') return false;
  const want = Buffer.from(signPayload(raw.toString('utf8'), secret));
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}

const webhooksRoutes: FastifyPluginAsync = async (app) => {
  // The signature is over the exact bytes sent, so keep them alongside the parsed body (this route group only).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new ApiError(400, 'The body isn’t valid JSON.', 'bad_request'), undefined);
    }
  });

  app.post('/webhooks/payments', async (req) => {
    const secret = config.payments.webhookSecret;
    if (!secret) throw unavailable('Payment webhooks aren’t configured.');
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (!verified(raw, req.headers['x-riona-signature'], secret)) throw new ApiError(401, 'Bad signature.', 'webhook.bad_signature');
    const p = parse(Payload, req.body);
    const settled = await settleIntent(p.intentId, { status: p.status, reference: p.reference, amountPaise: p.amount });
    if (!settled) throw notFound('Unknown payment.');
    return { ok: true as const, status: settled.status, changed: settled.changed };
  });
};

export default webhooksRoutes;
