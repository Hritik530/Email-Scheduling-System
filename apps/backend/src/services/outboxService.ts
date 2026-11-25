import { OutboxStatus, Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { getSharedRedisClient } from '../config/redis';
import {
  emailSendQueue,
  enqueueElasticsearchIndexJob,
  enqueueEmailJob,
} from '../queues/emailQueue';

interface EnqueueEmailPayload {
  emailId: string;
  campaignId: string;
  userId: string;
  senderId: string;
  scheduledAt: string;
}

interface IndexEmailPayload {
  emailId: string;
}

/**
 * Flushes pending outbox events to BullMQ queues.
 * Safe to run concurrently across API and worker startups because
 * BullMQ jobIds are deterministic (`emailId` and `es-${outboxEventId}`).
 */
export async function flushPendingOutboxEvents(limit = 200): Promise<number> {
  const events = await prisma.outboxEvent.findMany({
    where: {
      status: OutboxStatus.pending,
      availableAt: { lte: new Date() },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let publishedCount = 0;

  for (const event of events) {
    try {
      if (event.aggregateType === 'EMAIL_JOB' && event.eventType === 'ENQUEUE_EMAIL') {
        const payload = event.payload as unknown as EnqueueEmailPayload;
        const email = await prisma.scheduledEmail.findUnique({
          where: { id: payload.emailId },
          select: { id: true, status: true, scheduledAt: true },
        });

        if (email && email.status === 'scheduled') {
          await enqueueEmailJob(
            {
              emailId: payload.emailId,
              campaignId: payload.campaignId,
              userId: payload.userId,
              senderId: payload.senderId,
            },
            email.scheduledAt,
          );
        }
      } else if (
        event.aggregateType === 'ELASTICSEARCH_INDEX' &&
        event.eventType === 'INDEX_EMAIL'
      ) {
        const payload = event.payload as unknown as IndexEmailPayload;
        await enqueueElasticsearchIndexJob({
          emailId: payload.emailId,
          outboxEventId: event.id,
        });
      }

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxStatus.published,
          publishedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      publishedCount += 1;
    } catch (err) {
      const nextAttempts = event.attempts + 1;
      const backoffMs = Math.min(60_000, 2000 * Math.pow(2, nextAttempts));
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts: nextAttempts,
          lastError: (err as Error).message,
          availableAt: new Date(Date.now() + backoffMs),
          status: nextAttempts >= 10 ? OutboxStatus.failed : OutboxStatus.pending,
        },
      });
      logger.error(
        { err: (err as Error).message, outboxEventId: event.id },
        'Failed to flush outbox event',
      );
    }
  }

  return publishedCount;
}

/**
 * Reconciles PostgreSQL source-of-truth state with BullMQ on startup.
 * - Never re-enqueues `sent` or `cancelled` emails.
 * - Reclaims stale `processing` rows whose worker lock expired.
 * - Ensures every `scheduled` email has a matching BullMQ job.
 */
export async function reconcileDatabaseAndQueuesOnStartup(): Promise<{
  flushedOutbox: number;
  recoveredStale: number;
  requeuedMissing: number;
}> {
  let totalFlushed = 0;
  let batchFlushed = 0;
  do {
    batchFlushed = await flushPendingOutboxEvents(200);
    totalFlushed += batchFlushed;
  } while (batchFlushed === 200);

  // Reclaim stale `processing` records (e.g. worker crashed mid-flight)
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const staleEmails = await prisma.scheduledEmail.findMany({
    where: {
      status: 'processing',
      updatedAt: { lt: staleCutoff },
    },
    take: 200,
  });

  const redis = getSharedRedisClient();
  let recoveredStale = 0;

  for (const email of staleEmails) {
    const lockActive = await redis.exists(`lock:email:${email.id}`);
    if (lockActive) continue;

    const updated = await prisma.scheduledEmail.updateMany({
      where: { id: email.id, status: 'processing' },
      data: {
        status: 'scheduled',
        errorMessage: 'Recovered from interrupted worker processing',
      },
    });
    if (updated.count > 0) {
      recoveredStale += 1;
    }
  }

  // Ensure every `scheduled` email has a BullMQ job (only creates if missing)
  const scheduledEmails = await prisma.scheduledEmail.findMany({
    where: { status: 'scheduled' },
    select: {
      id: true,
      campaignId: true,
      userId: true,
      senderId: true,
      scheduledAt: true,
    },
    orderBy: { scheduledAt: 'asc' },
    take: 1000,
  });

  let requeuedMissing = 0;
  for (const email of scheduledEmails) {
    const existing = await emailSendQueue.getJob(email.id);
    if (!existing) {
      await enqueueEmailJob(
        {
          emailId: email.id,
          campaignId: email.campaignId,
          userId: email.userId,
          senderId: email.senderId,
        },
        email.scheduledAt,
      );
      requeuedMissing += 1;
    }
  }

  logger.info(
    {
      flushedOutbox: totalFlushed,
      recoveredStale,
      requeuedMissing,
    },
    'Startup database-queue reconciliation completed',
  );

  return {
    flushedOutbox: totalFlushed,
    recoveredStale,
    requeuedMissing,
  };
}

export function buildOutboxIndexEventData(emailId: string): Prisma.OutboxEventCreateManyInput {
  return {
    aggregateType: 'ELASTICSEARCH_INDEX',
    aggregateId: emailId,
    eventType: 'INDEX_EMAIL',
    payload: { emailId },
    status: OutboxStatus.pending,
  };
}
