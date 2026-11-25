import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export function buildRedisOptions(overrides?: Partial<RedisOptions>): RedisOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: true,
    retryStrategy(times: number): number {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ attempt: times, delay }, 'Redis connection retry scheduled');
      return delay;
    },
    reconnectOnError(err: Error): boolean {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some((msg) => err.message.includes(msg));
    },
    ...overrides,
  };
}

export function createRedisClient(name: string, overrides?: Partial<RedisOptions>): Redis {
  const client = new Redis(buildRedisOptions(overrides));

  client.on('connect', () => {
    logger.debug({ client: name }, 'Redis connecting');
  });

  client.on('ready', () => {
    logger.info({ client: name }, 'Redis ready');
  });

  client.on('error', (err) => {
    logger.error({ client: name, err: err.message }, 'Redis connection error');
  });

  client.on('reconnecting', () => {
    logger.warn({ client: name }, 'Redis reconnecting');
  });

  return client;
}

let sharedRedisClient: Redis | null = null;

export function getSharedRedisClient(): Redis {
  if (!sharedRedisClient) {
    sharedRedisClient = createRedisClient('shared');
  }
  return sharedRedisClient;
}

export async function closeSharedRedisClient(): Promise<void> {
  if (sharedRedisClient) {
    await sharedRedisClient.quit();
    sharedRedisClient = null;
  }
}
