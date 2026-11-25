import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { disconnectPrisma } from './config/prisma';
import { closeSharedRedisClient } from './config/redis';
import { ensureEmailIndex } from './integrations/elasticsearch/elasticsearchService';
import { closeQueues } from './queues/emailQueue';
import { reconcileDatabaseAndQueuesOnStartup } from './services/outboxService';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // Recover any unpublished outbox events and reconcile DB/BullMQ state
  await reconcileDatabaseAndQueuesOnStartup().catch((err) => {
    logger.warn(
      { err: (err as Error).message },
      'Startup queue reconciliation encountered a transient error',
    );
  });

  // Ensure Elasticsearch index exists (non-fatal if ES is starting up)
  await ensureEmailIndex().catch(() => undefined);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'ReachInbox API server listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Gracefully shutting down API server');

    server.close(async () => {
      try {
        await closeQueues();
        await closeSharedRedisClient();
        await disconnectPrisma();
        logger.info('API server shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during API server shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start API server');
  process.exit(1);
});
