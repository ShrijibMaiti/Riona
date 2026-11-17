/**
 * Request validation with zod. A failure becomes a 422 with a message per field; the first field's message
 * is the headline, because the frontend shows `message` as is.
 */
import { z, type ZodTypeAny } from 'zod';
import { unprocessable } from './errors';

export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) fields[i.path.join('.') || 'request'] ??= i.message;
  throw unprocessable(Object.values(fields)[0] ?? 'Check the highlighted details and try again.', fields);
}

/**
 * An optional query value. The frontend sends empty filters as `?dept=` (an empty string), which means "no
 * filter", not "the empty department".
 */
export const opt = <S extends ZodTypeAny>(schema: S) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

/** Shared field schemas. Messages are UI copy. */
export const F = {
  id: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-06.'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-11.'),
  email: z.string().trim().email('Enter a valid email.'),
  text: (max = 2000) => z.string().trim().max(max, `Keep it under ${max} characters.`),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).optional(),
  bool: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  list: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.string()).optional()),
};