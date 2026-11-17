/**
 * Direct database access for tests, on the test database (see env.ts). Use it to look behind the API:
 * sessions, audit rows, outbox rows, and attempts to break the append-only guards.
 */
import { sql } from 'kysely';
import { db } from '../../src/db/client';

export { db, sql };

export const count = async (table: string, where = 'true') =>
  Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)} WHERE ${sql.raw(where)}`.execute(db)).rows[0].n);

/** Run raw SQL and return the database error message, or null if it succeeded. */
export async function sqlError(statement: string): Promise<string | null> {
  try {
    await sql.raw(statement).execute(db);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
