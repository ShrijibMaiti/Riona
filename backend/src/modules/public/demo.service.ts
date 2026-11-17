/**
 * POST /demo-requests — "Book a demo" on the public site. No sign-in, so: validated, at most five per hour from
 * one address, stored, and passed to the Admins (in-app).
 */
import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../db/client';
import { SYSTEM_ACTOR, withTransaction } from '../../db/tx';
import { ApiError, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';

export const DemoRequest = z.object({
  name: z.string().max(200).default(''),
  email: z.string().max(200).default(''),
  company: z.string().max(200).default(''),
  size: z.string().max(40).default(''),
});

const PER_HOUR = 5;

export async function requestDemo(input: z.infer<typeof DemoRequest>, ip: string) {
  if (!input.name.trim() || !/^\S+@\S+\.\S+$/.test(input.email.trim())) throw unprocessable('Add your name and a valid work email.', { email: 'Invalid' });
  const recent = Number((await db.selectFrom('demoRequests').select(sql<number>`count(*)`.as('n')).where('ip', '=', ip).where('createdAt', '>', new Date(Date.now() - 3600_000).toISOString()).executeTakeFirstOrThrow()).n);
  if (recent >= PER_HOUR) throw new ApiError(429, 'We’ve had a few requests from you already — we’ll be in touch soon.', 'rate_limited');
  await withTransaction({ ...SYSTEM_ACTOR, name: 'Public site', ip }, async (tx) => {
    const id = newId('DR');
    await tx.db.insertInto('demoRequests').values({ id, name: input.name.trim(), email: input.email.trim(), company: input.company.trim(), size: input.size.trim(), ip }).execute();
    await tx.audit('Created', 'Demo request', id, [{ field: 'email', before: null, after: input.email.trim() }]);
    const admins = (await tx.db.selectFrom('users').select('employeeId').where('role', '=', 'Admin').where('status', '=', 'Active').where('employeeId', 'is not', null).execute()).map((u) => u.employeeId!);
    if (admins.length) await tx.notify({ recipientIds: admins, kind: 'System', text: `Demo request from ${input.name.trim()}${input.company.trim() ? ' · ' + input.company.trim() : ''}`, href: '/app/admin' });
  });
  return { ok: true as const };
}
