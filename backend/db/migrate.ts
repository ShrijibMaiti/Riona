/**
 * Applies db/migrations/*.sql in name order, each in its own transaction, and records them in
 * schema_migrations. Already-applied files are skipped; an edited applied file is refused (checksum).
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:reset              DROP everything, then migrate (development only)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DIR = join(import.meta.dirname, 'migrations');

export async function migrate(url: string, opts: { reset?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const client = new pg.Client({ connectionString: url, options: '-c timezone=UTC' });
  await client.connect();
  try {
    if (opts.reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      log('Reset: dropped every table.');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    let n = 0;
    for (const f of files) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      // A placeholder for a later wave (still empty): not applied, so it can be filled in later.
      if (!sql.replace(/--.*$/gm, '').trim()) continue;
      const sum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`${f} was changed after it was applied. Add a new migration instead.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, sum]);
        await client.query('COMMIT');
        log(`Applied ${f}`);
        n++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`${f} failed: ${(e as Error).message}`);
      }
    }
    log(n ? `${n} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) {
  const { config } = await import('../src/config');
  const reset = process.argv.includes('--reset');
  if (reset && config.isProd) {
    console.error('Refusing to reset a production database.');
    process.exit(1);
  }
  migrate(config.db.url, { reset }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}