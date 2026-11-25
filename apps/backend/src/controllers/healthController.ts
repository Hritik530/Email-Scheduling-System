import { Request, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { getSharedRedisClient } from '../config/redis';
import { pingElasticsearch } from '../integrations/elasticsearch/elasticsearchService';
import { sendSuccess } from '../utils/httpResponse';

export async function healthCheckHandler(_req: Request, res: Response): Promise<void> {
  const [dbOk, redisOk, esOk] = await Promise.all([
    prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false),
    getSharedRedisClient()
      .ping()
      .then((resStr) => resStr === 'PONG')
      .catch(() => false),
    pingElasticsearch(),
  ]);

  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        postgres: dbOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
        elasticsearch: esOk ? 'up' : 'down',
      },
    },
  });
}

export function getRuntimeConfigHandler(_req: Request, res: Response): void {
  sendSuccess(res, {
    workerConcurrency: env.WORKER_CONCURRENCY,
    maxRetryAttempts: env.MAX_RETRY_ATTEMPTS,
    retryDelayMs: env.RETRY_DELAY,
    defaultEmailDelayMs: env.DEFAULT_EMAIL_DELAY,
    minEmailDelayMs: env.MIN_EMAIL_DELAY_MS,
    maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    etherealHost: env.ETHEREAL_HOST,
    etherealPort: env.ETHEREAL_PORT,
  });
}
