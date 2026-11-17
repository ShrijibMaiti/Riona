/** Wave 0: the server boots, answers /health, and every failure has the shape { error: { message, code } }. */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { closeDb } from '../src/db/client';
import { conflict } from '../src/lib/errors';
import { parse } from '../src/lib/validate';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // Routes that fail on purpose, to exercise the error plugin.
  app.get('/api/v1/__test/conflict', async () => {
    throw conflict('This room is already booked for that time.', 'room_taken');
  });
  app.post('/api/v1/__test/validate', async (req) => parse(z.object({ reason: z.string().min(3, 'Give a reason.') }), req.body));
  app.get('/api/v1/__test/bug', async () => {
    throw new Error('relation "secret_table" does not exist');
  });
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const errorBody = z.object({ error: z.object({ message: z.string().min(1), code: z.string().min(1), requestId: z.string(), fields: z.record(z.string()).optional() }) });

describe('GET /api/v1/health', () => {
  it('answers 200 with the database up', async () => {
    const res = await app.inject({ url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up', timeZone: 'Asia/Kolkata' });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('error contract', () => {
  it('unknown route: 404 { error: { message, code } }', async () => {
    const res = await app.inject({ url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(errorBody.parse(res.json()).error).toMatchObject({ code: 'not_found', message: 'We couldn’t find that.' });
    expect(res.json().error.requestId).toBe(res.headers['x-request-id']);
  });

  it('ApiError: sent with its status, message and code', async () => {
    const res = await app.inject({ url: '/api/v1/__test/conflict' });
    expect(res.statusCode).toBe(409);
    expect(errorBody.parse(res.json()).error).toMatchObject({ code: 'room_taken', message: 'This room is already booked for that time.' });
  });

  it('validation: 422 with a message per field, the first as the headline', async () => {
    // POSTs carry the CSRF header like the frontend (http/plugins/csrf.ts, Wave 1).
    const res = await app.inject({ method: 'POST', url: '/api/v1/__test/validate', headers: { 'x-requested-with': 'riona' }, payload: { reason: 'x' } });
    expect(res.statusCode).toBe(422);
    expect(errorBody.parse(res.json()).error).toMatchObject({ code: 'validation', message: 'Give a reason.', fields: { reason: 'Give a reason.' } });
  });

  it('malformed JSON: 400 in plain copy', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/__test/validate', headers: { 'content-type': 'application/json', 'x-requested-with': 'riona' }, payload: '{bad' });
    expect(res.statusCode).toBe(400);
    expect(errorBody.parse(res.json()).error).toMatchObject({ code: 'bad_request', message: 'That request wasn’t valid.' });
  });

  it('an unexpected error: generic 500 that leaks nothing', async () => {
    const res = await app.inject({ url: '/api/v1/__test/bug' });
    expect(res.statusCode).toBe(500);
    expect(errorBody.parse(res.json()).error).toMatchObject({ code: 'internal', message: 'Something went wrong on our side. Try again in a moment.' });
    expect(res.body).not.toContain('secret_table');
  });
});
