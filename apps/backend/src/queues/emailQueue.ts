import { Queue } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { createRedisClient } from '../config/redis';

export const EMAIL_SEND_QUEUE_NAME = 'email-send-queue';
export const ELASTICSEARCH_INDEX_QUEUE_NAME = 'elasticsearch-index-queue';

export interface EmailSendJobData {
  emailId: string;
  campaignId: string;
  userId: string;
  senderId: string;
}

export interface ElasticsearchIndexJobData {
  emailId: string;
  outboxEventId?: string;
}

const queueConnection = createRedisClient('bullmq-queues');

export const emailSendQueue = new Queue<EmailSendJobData>(EMAIL_SEND_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: env.MAX_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: env.RETRY_DELAY,
    },
    removeOnComplete: {
      age: 86400,
      count: 2000,
    },
    removeOnFail: {
      age: 604800,
      count: 5000,
    },
  },
});

export const elasticsearchIndexQueue = new Queue<ElasticsearchIndexJobData>(
  ELASTICSEARCH_INDEX_QUEUE_NAME,
  {
    connection: queueConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 86400,
        count: 2000,
      },
    },
  },
);

export async function enqueueEmailJob(
  data: EmailSendJobData,
  scheduledAt: Date,
): Promise<void> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  const existingJob = await emailSendQueue.getJob(data.emailId);
  if (existingJob) {
    logger.debug({ emailId: data.emailId }, 'BullMQ job already exists for email, skipping duplicate enqueue');
    return;
  }

  await emailSendQueue.add('send-email', data, {
    jobId: data.emailId,
    delay,
  });
}

export async function cancelEmailJob(emailId: string): Promise<boolean> {
  const job = await emailSendQueue.getJob(emailId);
  if (!job) {
    return false;
  }
  const state = await job.getState();
  if (state === 'delayed' || state === 'waiting' || state === 'prioritized') {
    await job.remove();
    return true;
  }
  return false;
}

export async function enqueueElasticsearchIndexJob(
  data: ElasticsearchIndexJobData,
  delayMs = 0,
): Promise<void> {
  await elasticsearchIndexQueue.add('index-email', data, {
    jobId: data.outboxEventId ? `es-${data.outboxEventId}` : undefined,
    delay: delayMs,
  });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([emailSendQueue.close(), elasticsearchIndexQueue.close()]);
  await queueConnection.quit();
}
