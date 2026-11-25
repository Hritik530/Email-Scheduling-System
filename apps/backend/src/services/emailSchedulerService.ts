import { CampaignStatus, EmailStatus, OutboxStatus, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { cancelEmailJob } from '../queues/emailQueue';
import { sha256Hex } from '../utils/crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { buildOutboxIndexEventData, flushPendingOutboxEvents } from './outboxService';

export interface ScheduleEmailsInput {
  userId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenEmails?: number;
  hourlyLimit?: number;
  senderId: string;
  idempotencyKey?: string;
}

export async function scheduleEmails(input: ScheduleEmailsInput) {
  const sender = await prisma.emailSender.findUnique({
    where: { id: input.senderId },
  });

  if (!sender || sender.userId !== input.userId) {
    throw new NotFoundError('Selected email sender was not found');
  }

  if (!sender.isActive) {
    throw new ValidationError('Selected email sender is currently inactive');
  }

  // Normalize and deduplicate recipients while preserving order
  const seen = new Set<string>();
  const uniqueRecipients: string[] = [];
  for (const raw of input.recipients) {
    const normalized = raw.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      uniqueRecipients.push(normalized);
    }
  }

  if (uniqueRecipients.length === 0) {
    throw new ValidationError('At least one valid recipient email is required');
  }

  const delayBetweenEmails = input.delayBetweenEmails ?? env.DEFAULT_EMAIL_DELAY;
  const hourlyLimit = input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const startMs = input.startTime.getTime();

  const campaignIdempotencyKey =
    input.idempotencyKey?.trim() ||
    sha256Hex(
      JSON.stringify({
        userId: input.userId,
        senderId: input.senderId,
        subject: input.subject.trim(),
        body: input.body,
        startTime: input.startTime.toISOString(),
        recipients: uniqueRecipients,
      }),
    );

  // Check for existing duplicate campaign submission
  const existingCampaign = await prisma.emailCampaign.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: campaignIdempotencyKey,
      },
    },
    include: {
      scheduledEmails: {
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });

  if (existingCampaign) {
    return {
      duplicate: true,
      campaign: existingCampaign,
      scheduledCount: existingCampaign.scheduledEmails.length,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.emailCampaign.create({
      data: {
        userId: input.userId,
        senderId: input.senderId,
        subject: input.subject.trim(),
        body: input.body,
        startTime: input.startTime,
        delayBetweenEmails,
        hourlyLimit,
        idempotencyKey: campaignIdempotencyKey,
        status: CampaignStatus.scheduled,
      },
    });

    const createdEmails: Array<{
      id: string;
      recipientEmail: string;
      scheduledAt: Date;
      status: EmailStatus;
    }> = [];

    const outboxRows: Prisma.OutboxEventCreateManyInput[] = [];

    for (let i = 0; i < uniqueRecipients.length; i += 1) {
      const recipientEmail = uniqueRecipients[i];
      const scheduledAt = new Date(startMs + i * delayBetweenEmails);
      const emailIdempotencyKey = sha256Hex(`${campaign.id}:${recipientEmail}`);

      const created = await tx.scheduledEmail.create({
        data: {
          campaignId: campaign.id,
          userId: input.userId,
          senderId: input.senderId,
          recipientEmail,
          subject: campaign.subject,
          body: campaign.body,
          scheduledAt,
          status: EmailStatus.scheduled,
          idempotencyKey: emailIdempotencyKey,
        },
        select: {
          id: true,
          recipientEmail: true,
          scheduledAt: true,
          status: true,
        },
      });

      createdEmails.push(created);

      outboxRows.push(
        {
          aggregateType: 'EMAIL_JOB',
          aggregateId: created.id,
          eventType: 'ENQUEUE_EMAIL',
          payload: {
            emailId: created.id,
            campaignId: campaign.id,
            userId: input.userId,
            senderId: input.senderId,
            scheduledAt: scheduledAt.toISOString(),
          },
          status: OutboxStatus.pending,
        },
        buildOutboxIndexEventData(created.id),
      );
    }

    await tx.outboxEvent.createMany({ data: outboxRows });

    return { campaign, createdEmails };
  });

  // Immediately flush outbox after transaction commits;
  // any transient Redis/ES outage leaves events in outbox for recovery.
  try {
    await flushPendingOutboxEvents(Math.max(200, uniqueRecipients.length * 2));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, campaignId: result.campaign.id },
      'Immediate outbox flush failed after commit; pending outbox will recover',
    );
  }

  return {
    duplicate: false,
    campaign: result.campaign,
    scheduledCount: result.createdEmails.length,
    emails: result.createdEmails,
  };
}

export async function listScheduledEmails(params: {
  userId: string;
  status?: string;
  search?: string;
  page: number;
  limit: number;
}) {
  const where: Prisma.ScheduledEmailWhereInput = {
    userId: params.userId,
  };

  if (params.status && params.status !== 'all') {
    where.status = params.status as EmailStatus;
  } else {
    where.status = { in: ['scheduled', 'processing', 'cancelled', 'failed'] };
  }

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { recipientEmail: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
      { campaignId: { contains: q, mode: 'insensitive' } },
      { sender: { email: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.scheduledEmail.count({ where }),
    prisma.scheduledEmail.findMany({
      where,
      include: {
        sender: { select: { id: true, email: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { items, total, page: params.page, limit: params.limit };
}

export async function listSentEmails(params: {
  userId: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}) {
  const where: Prisma.ScheduledEmailWhereInput = {
    userId: params.userId,
    status:
      params.status && (params.status === 'sent' || params.status === 'failed')
        ? (params.status as EmailStatus)
        : { in: ['sent', 'failed'] },
  };

  if (params.from || params.to) {
    where.OR = [
      {
        sentAt: {
          ...(params.from ? { gte: new Date(params.from) } : {}),
          ...(params.to ? { lte: new Date(params.to) } : {}),
        },
      },
      {
        updatedAt: {
          ...(params.from ? { gte: new Date(params.from) } : {}),
          ...(params.to ? { lte: new Date(params.to) } : {}),
        },
      },
    ];
  }

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.AND = [
      {
        OR: [
          { recipientEmail: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
          { smtpMessageId: { contains: q, mode: 'insensitive' } },
          { sender: { email: { contains: q, mode: 'insensitive' } } },
        ],
      },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.scheduledEmail.count({ where }),
    prisma.scheduledEmail.findMany({
      where,
      include: {
        sender: { select: { id: true, email: true } },
      },
      orderBy: [{ sentAt: 'desc' }, { updatedAt: 'desc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
  ]);

  return { items, total, page: params.page, limit: params.limit };
}

export async function getEmailDetail(userId: string, emailId: string) {
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: {
      sender: { select: { id: true, email: true } },
      campaign: {
        select: {
          id: true,
          subject: true,
          startTime: true,
          delayBetweenEmails: true,
          hourlyLimit: true,
          status: true,
        },
      },
    },
  });

  if (!email) {
    throw new NotFoundError('Email not found');
  }

  if (email.userId !== userId) {
    throw new ForbiddenError('You do not have access to this email');
  }

  return email;
}

export async function cancelScheduledEmail(userId: string, emailId: string) {
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
  });

  if (!email) {
    throw new NotFoundError('Scheduled email not found');
  }

  if (email.userId !== userId) {
    throw new ForbiddenError('You do not have access to cancel this email');
  }

  if (email.status === 'sent') {
    throw new ConflictError('Cannot cancel an email that has already been sent');
  }

  if (email.status === 'cancelled') {
    return email;
  }

  if (email.status === 'processing') {
    throw new ConflictError('Cannot cancel an email while it is currently being sent');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.scheduledEmail.update({
      where: { id: emailId },
      data: { status: EmailStatus.cancelled },
    });
    await tx.outboxEvent.create({
      data: buildOutboxIndexEventData(emailId),
    });
    return row;
  });

  await cancelEmailJob(emailId).catch((err) => {
    logger.warn({ err: (err as Error).message, emailId }, 'Failed to remove cancelled job from BullMQ');
  });

  await flushPendingOutboxEvents(10).catch(() => undefined);
  await syncCampaignStatus(email.campaignId);

  return updated;
}

export async function getDashboardSummary(userId: string) {
  const grouped = await prisma.scheduledEmail.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });

  const counts: Record<EmailStatus, number> = {
    scheduled: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  const total =
    counts.scheduled + counts.processing + counts.sent + counts.failed + counts.cancelled;

  return {
    total,
    sent: counts.sent,
    failed: counts.failed,
    pending: counts.scheduled + counts.processing,
    cancelled: counts.cancelled,
    breakdown: counts,
  };
}

export async function syncCampaignStatus(campaignId: string): Promise<void> {
  const grouped = await prisma.scheduledEmail.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });

  if (grouped.length === 0) return;

  const counts: Record<EmailStatus, number> = {
    scheduled: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }

  const total =
    counts.scheduled + counts.processing + counts.sent + counts.failed + counts.cancelled;

  let status: CampaignStatus = CampaignStatus.in_progress;

  if (counts.scheduled + counts.processing === 0) {
    if (counts.cancelled === total) {
      status = CampaignStatus.cancelled;
    } else if (counts.sent === total) {
      status = CampaignStatus.completed;
    } else {
      status = CampaignStatus.partial;
    }
  } else if (counts.sent === 0 && counts.failed === 0 && counts.processing === 0) {
    status = CampaignStatus.scheduled;
  }

  await prisma.emailCampaign.update({
    where: { id: campaignId },
    data: { status },
  });
}
