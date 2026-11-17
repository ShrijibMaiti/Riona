/**
 * Every failure leaves the API in one shape: { error: { message, code, fields?, requestId } }.
 *
 * - ApiError (lib/errors.ts): sent as thrown. Its message is UI copy.
 * - Schema validation failures: 422 with a message per field.
 * - Fastify's own client errors (bad JSON, body too large, wrong content type): their status, with plain copy.
 * - Anything else is a bug: logged with its stack, answered with a generic 500 that leaks nothing.
 */
import type { FastifyError, FastifyPluginAsync, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ErrorCodes, type ApiErrorBody, type ErrorCode } from '@riona/shared';
import { isApiError } from '../../lib/errors';

const send = (reply: FastifyReply, status: number, message: string, code: ErrorCode, fields?: Record<string, string>) => {
  const body: ApiErrorBody = { error: { message, code, requestId: String(reply.request.id) } };
  if (fields && Object.keys(fields).length) body.error.fields = fields;
  return reply.status(status).type('application/json').send(body);
};

/** Fastify client errors, by status, in the same plain voice as the rest of the UI. */
const CLIENT_ERRORS: Record<number, [string, ErrorCode]> = {
  400: ['That request wasn’t valid.', ErrorCodes.BAD_REQUEST],
  401: ['Your session has ended. Sign in again.', ErrorCodes.UNAUTHENTICATED],
  403: ['You don’t have access to this.', ErrorCodes.FORBIDDEN],
  404: ['We couldn’t find that.', ErrorCodes.NOT_FOUND],
  413: ['That file is too large.', ErrorCodes.PAYLOAD_TOO_LARGE],
  415: ['That request wasn’t valid.', ErrorCodes.BAD_REQUEST],
  429: ['Too many requests. Wait a moment and try again.', ErrorCodes.RATE_LIMITED],
};

/** Turn Fastify/ajv validation errors into { field: message }. */
function fieldsOf(err: FastifyError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of err.validation ?? []) {
    const missing = (v.params as { missingProperty?: string } | undefined)?.missingProperty;
    const path = (v.instancePath || '').replace(/^\//, '').replace(/\//g, '.');
    const field = missing ?? (path || err.validationContext || 'request');
    out[field] ??= missing ? 'Required' : v.message ?? 'Not valid';
  }
  return out;
}

const errorsPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (isApiError(err)) {
      if (err.status >= 500) req.log.error({ err }, err.message);
      return send(reply, err.status, err.message, err.code, err.fields);
    }
    if (err.validation) {
      return send(reply, 422, 'Check the highlighted details and try again.', ErrorCodes.VALIDATION, fieldsOf(err));
    }
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const [message, code] = CLIENT_ERRORS[status] ?? CLIENT_ERRORS[400];
      return send(reply, status, message, code);
    }
    req.log.error({ err }, 'Unhandled error');
    return send(reply, 500, 'Something went wrong on our side. Try again in a moment.', ErrorCodes.INTERNAL);
  });

  app.setNotFoundHandler(async (_req, reply) => {
    return send(reply, 404, 'We couldn’t find that.', ErrorCodes.NOT_FOUND);
  });
};

// fastify-plugin lifts the handlers to the root instance, so they apply to every route.
export default fp(errorsPlugin, { name: 'riona-errors', fastify: '5.x' });