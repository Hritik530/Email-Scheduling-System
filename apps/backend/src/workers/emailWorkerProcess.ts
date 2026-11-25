import { Worker } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { disconnectPrisma } from '../config/prisma';
import { closeSharedRedisClient, createRedisClient } from '../config/redis';
import {
  closeQueues,
  ELASTICSEARCH_INDEX_QUEUE_NAME,
  ElasticsearchIndexJobData,
  EMAIL_SEND_QUEUE_NAME,
  EmailSendJobData,
} from '../queues/emailQueue';
import { reconcileDatabaseAndQueuesOnStartup } from '../services/outboxService';
import { processElasticsearchIndexJob, processEmailJob } from './emailProcessor';

async function startWorkerProcess(): Promise<void> {
  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minDelayMs: env.MIN_EMAIL_DELAY_MS,
      hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      maxRetries: env.MAX_RETRY_ATTEMPTS,
    },
    'Starting ReachInbox BullMQ worker process',
  );

  await reconcileDatabaseAndQueuesOnStartup();

  const emailWorkerConnection = createRedisClient('worker-email');
  const esWorkerConnection = createRedisClient('worker-es');

  const emailWorker = new Worker<EmailSendJobData>(
    EMAIL_SEND_QUEUE_NAME,
    async (job, token) => processEmailJob(job, token),
    {
      connection: emailWorkerConnection,
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  const esWorker = new Worker<ElasticsearchIndexJobData>(
    ELASTICSEARCH_INDEX_QUEUE_NAME,
    async (job) => processElasticsearchIndexJob(job),
    {
      connection: esWorkerConnection,
      concurrency: 5,
    },
  );

  emailWorker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, result }, 'Email job completed');
  });

  emailWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Email job failed');
  });

  emailWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'Email worker error');
  });

  esWorker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'Elasticsearch indexing job failed');
  });

  esWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'Elasticsearch worker error');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Gracefully shutting down worker process');

    try {
      await Promise.all([emailWorker.close(), esWorker.close()]);
      await Promise.all([emailWorkerConnection.quit(), esWorkerConnection.quit()]);
      await closeQueues();
      await closeSharedRedisClient();
      await disconnectPrisma();
      logger.info('Worker shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void startWorkerProcess().catch((err) => {
  logger.fatal({ err }, 'Worker process failed to start');
  process.exit(1);
});
