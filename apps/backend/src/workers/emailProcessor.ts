import { DelayedError, Job } from 'bullmq';
import { EmailStatus } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { indexEmailDocument } from '../integrations/elasticsearch/elasticsearchService';
import { sendRateLimitSlackNotification } from '../integrations/slack/slackService';
import { sendEmailViaSmtp } from '../integrations/smtp/smtpService';
import { ElasticsearchIndexJobData, EmailSendJobData } from '../queues/emailQueue';
import { syncCampaignStatus } from '../services/emailSchedulerService';
import {
  buildOutboxIndexEventData,
  flushPendingOutboxEvents,
} from '../services/outboxService';
import {
  acquireEmailLock,
  releaseEmailLock,
  releaseHourlySlot,
  reserveSendSlot,
} from '../services/rateLimiterService';

export interface ProcessEmailResult {
  outcome: 'sent' | 'skipped' | 'rescheduled';
  reason?: string;
  messageId?: string;
  etherealPreviewUrl?: string | null;
  retryAtMs?: number;
}

export async function processEmailJob(
  job: Job<EmailSendJobData>,
  token?: string,
): Promise<ProcessEmailResult> {
  const { emailId } = job.data;
  const lockToken = await acquireEmailLock(emailId, 60_000);

  if (!lockToken) {
    const retryAtMs = Date.now() + 2000;
    if (token) {
      await job.moveToDelayed(retryAtMs, token);
      throw new DelayedError();
    }
    return { outcome: 'rescheduled', reason: 'lock_contended', retryAtMs };
  }

  try {
    const email = await prisma.scheduledEmail.findUnique({
      where: { id: emailId },
      include: {
        sender: true,
        campaign: true,
      },
    });

    if (!email) {
      logger.warn({ emailId }, 'Email record not found, skipping job');
      return { outcome: 'skipped', reason: 'not_found' };
    }

    if (email.status === EmailStatus.sent || email.status === EmailStatus.cancelled) {
      logger.debug({ emailId, status: email.status }, 'Email already finalized, skipping');
      return { outcome: 'skipped', reason: email.status };
    }

    if (!email.sender.isActive) {
      await prisma.$transaction(async (tx) => {
        await tx.scheduledEmail.update({
          where: { id: email.id },
          data: {
            status: EmailStatus.failed,
            errorMessage: 'Sender is inactive',
          },
        });
        await tx.outboxEvent.create({ data: buildOutboxIndexEventData(email.id) });
      });
      await syncCampaignStatus(email.campaignId);
      return { outcome: 'skipped', reason: 'sender_inactive' };
    }

    const effectiveMinDelay = Math.max(
      email.campaign.delayBetweenEmails,
      env.MIN_EMAIL_DELAY_MS,
    );
    const effectiveHourlyLimit = Math.min(
      email.campaign.hourlyLimit,
      env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    );

    const reservation = await reserveSendSlot(
      email.senderId,
      effectiveMinDelay,
      effectiveHourlyLimit,
    );

    if (reservation.status === 'HOURLY_LIMIT_REACHED') {
      const nextWindowAt = new Date(reservation.retryAtMs);

      await prisma.$transaction(async (tx) => {
        await tx.scheduledEmail.update({
          where: { id: email.id },
          data: {
            scheduledAt: nextWindowAt,
            status: EmailStatus.scheduled,
          },
        });
        await tx.outboxEvent.create({ data: buildOutboxIndexEventData(email.id) });
      });

      await sendRateLimitSlackNotification({
        userId: email.userId,
        senderId: email.senderId,
        senderEmail: email.sender.email,
        campaignId: email.campaignId,
        hourlyLimit: effectiveHourlyLimit,
        sentInWindow: reservation.sentCountInWindow,
        hourBucket: reservation.hourBucket,
        reachedAt: new Date(),
        nextWindowAt,
      });

      await flushPendingOutboxEvents(10).catch(() => undefined);

      if (token) {
        await job.moveToDelayed(reservation.retryAtMs, token);
        throw new DelayedError();
      }
      return {
        outcome: 'rescheduled',
        reason: 'hourly_limit_reached',
        retryAtMs: reservation.retryAtMs,
      };
    }

    if (reservation.status === 'MIN_DELAY') {
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: {
          scheduledAt: new Date(reservation.retryAtMs),
          status: EmailStatus.scheduled,
        },
      });

      if (token) {
        await job.moveToDelayed(reservation.retryAtMs, token);
        throw new DelayedError();
      }
      return {
        outcome: 'rescheduled',
        reason: 'min_delay',
        retryAtMs: reservation.retryAtMs,
      };
    }

    // Slot acquired; atomically claim email in PostgreSQL
    const claim = await prisma.scheduledEmail.updateMany({
      where: {
        id: email.id,
        status: { in: [EmailStatus.scheduled, EmailStatus.processing] },
      },
      data: {
        status: EmailStatus.processing,
        attempts: { increment: 1 },
      },
    });

    if (claim.count === 0) {
      await releaseHourlySlot(email.senderId, reservation.hourBucket);
      return { outcome: 'skipped', reason: 'already_claimed_or_finalized' };
    }

    try {
      const sendResult = await sendEmailViaSmtp({
        sender: email.sender,
        to: email.recipientEmail,
        subject: email.subject,
        body: email.body,
        idempotencyKey: email.idempotencyKey,
      });

      await prisma.$transaction(async (tx) => {
        await tx.scheduledEmail.update({
          where: { id: email.id },
          data: {
            status: EmailStatus.sent,
            sentAt: new Date(),
            smtpMessageId: sendResult.messageId,
            etherealPreviewUrl: sendResult.etherealPreviewUrl,
            errorMessage: null,
          },
        });
        await tx.outboxEvent.create({ data: buildOutboxIndexEventData(email.id) });
      });

      await syncCampaignStatus(email.campaignId);
      await flushPendingOutboxEvents(10).catch(() => undefined);

      return {
        outcome: 'sent',
        messageId: sendResult.messageId,
        etherealPreviewUrl: sendResult.etherealPreviewUrl,
      };
    } catch (smtpErr) {
      // Do not count failed SMTP attempts against the hourly quota
      await releaseHourlySlot(email.senderId, reservation.hourBucket).catch((relErr) => {
        logger.error({ err: (relErr as Error).message }, 'Failed to release hourly slot after SMTP error');
      });

      const maxAttempts = job.opts.attempts ?? env.MAX_RETRY_ATTEMPTS;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      const errorMsg = (smtpErr as Error).message || 'SMTP delivery failed';

      await prisma.$transaction(async (tx) => {
        await tx.scheduledEmail.update({
          where: { id: email.id },
          data: {
            status: isFinalAttempt ? EmailStatus.failed : EmailStatus.scheduled,
            errorMessage: errorMsg,
          },
        });
        await tx.outboxEvent.create({ data: buildOutboxIndexEventData(email.id) });
      });

      if (isFinalAttempt) {
        await syncCampaignStatus(email.campaignId);
      }
      await flushPendingOutboxEvents(10).catch(() => undefined);

      logger.error(
        {
          emailId: email.id,
          attempt: job.attemptsMade + 1,
          maxAttempts,
          isFinalAttempt,
          err: errorMsg,
        },
        'SMTP delivery failed for scheduled email',
      );

      throw smtpErr;
    }
  } finally {
    await releaseEmailLock(emailId, lockToken).catch((err) => {
      logger.warn({ err: (err as Error).message, emailId }, 'Failed to release email lock');
    });
  }
}

export async function processElasticsearchIndexJob(
  job: Job<ElasticsearchIndexJobData>,
): Promise<void> {
  const { emailId } = job.data;
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: {
      sender: { select: { email: true } },
    },
  });

  if (!email) return;

  await indexEmailDocument({
    emailId: email.id,
    userId: email.userId,
    campaignId: email.campaignId,
    senderEmail: email.sender.email,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    createdAt: email.createdAt.toISOString(),
  });
}
