/**
 * Start-up: check the database, open the port, and shut down cleanly on Ctrl+C or a container stop
 * (finish in-flight requests, then close the pool).
 */
import { config } from './config';
import { buildApp } from './app';
import { closeDb, pingDb } from './db/client';
import { startScheduler } from './jobs/scheduler';

async function main() {
  const app = await buildApp();

  if (!(await pingDb())) {
    app.log.warn('Database not reachable. Is it running? (npm run db:up) Starting anyway; /health will report it.');
  }

  // Background jobs (outbox delivery). Stopped before the pool closes on shutdown.
  const stopJobs = startScheduler(app.log);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      stopJobs();
      await app.close();
      await closeDb();
      clearTimeout(force);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Riona API on http://localhost:${config.port}${config.apiPrefix}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});