/** Meeting rooms and bookings. Open to all staff; a booking can't overlap another in the same room. */
import type { Booking, Room } from '@riona/shared';
import { z } from 'zod';
import { db } from '../../db/client';
import { withTransaction } from '../../db/tx';
import { authorize, selfId } from '../../auth/rbac/authorize';
import type { Actor } from '../../http/plugins/session';
import { conflict, unprocessable } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { F } from '../../lib/validate';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30.');
export const NewBooking = z.object({
  roomId: z.string().min(1, 'Choose a room.').max(40),
  date: F.date,
  start: TIME,
  end: z.union([TIME, z.literal('24:00')]),
  title: z.string().max(200).default(''),
});

const toBooking = (b: { id: string; roomId: string; date: string; start: string; end: string; title: string; bookedById: string }): Booking =>
  ({ id: b.id, roomId: b.roomId, date: b.date, start: b.start, end: b.end, title: b.title, bookedById: b.bookedById });

/** GET /rooms */
export async function listRooms(actor: Actor): Promise<Room[]> {
  authorize(actor, 'directory', 'view');
  const rows = await db.selectFrom('rooms').selectAll().orderBy('id').execute();
  return rows.map((r) => ({ id: r.id, name: r.name, floor: r.floor, capacity: r.capacity, equipment: r.equipment }));
}

/** GET /bookings?date */
export async function listBookings(actor: Actor, date: string): Promise<Booking[]> {
  authorize(actor, 'directory', 'view');
  const rows = await db.selectFrom('bookings').selectAll().where('date', '=', date).orderBy('roomId').orderBy('start').execute();
  return rows.map(toBooking);
}

/** POST /bookings — refuses an overlap (409), checked under a lock on the room. */
export async function createBooking(actor: Actor, input: z.infer<typeof NewBooking>): Promise<Booking> {
  const me = selfId(actor);
  if (input.end <= input.start) throw unprocessable('End after start.', { end: 'Before start' });
  return withTransaction(actor, async (tx) => {
    const room = await tx.db.selectFrom('rooms').select('id').where('id', '=', input.roomId).forUpdate().executeTakeFirst();
    if (!room) throw unprocessable('Choose a room.', { roomId: 'Unknown' });
    const clash = await tx.db.selectFrom('bookings').select('id').where('roomId', '=', input.roomId).where('date', '=', input.date)
      .where('start', '<', input.end).where('end', '>', input.start).executeTakeFirst();
    if (clash) throw conflict('That room is taken for part of this time.', 'booking.overlap');
    const b = { id: newId('BK'), roomId: input.roomId, date: input.date, start: input.start, end: input.end, title: input.title.trim() || 'Meeting', bookedById: me };
    await tx.db.insertInto('bookings').values(b).execute();
    return toBooking(b);
  });
}
