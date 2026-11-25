import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userA = {
  id: 'user-a',
  googleId: 'g-a',
  email: 'usera@example.com',
  name: 'User A',
  avatar: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const userB = {
  id: 'user-b',
  googleId: 'g-b',
  email: 'userb@example.com',
  name: 'User B',
  avatar: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const senderA = {
  id: 'sender-a',
  userId: 'user-a',
  email: 'sender-a@ethereal.email',
  smtpHost: 'smtp.ethereal.email',
  smtpPort: 587,
  smtpUsername: 'sender-a@ethereal.email',
  encryptedSmtpPassword: 'iv:tag:cipher',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const dbState = {
  campaigns: new Map<string, any>(),
  emails: new Map<string, any>(),
  outbox: [] as any[],
};

vi.mock('../src/config/prisma', () => {
  const txMock = {
    emailCampaign: {
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `camp-${dbState.campaigns.size + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbState.campaigns.set(row.id, row);
        return row;
      }),
    },
    scheduledEmail: {
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `email-${dbState.emails.size + 1}`,
          ...data,
          attempts: 0,
          sentAt: null,
          errorMessage: null,
          smtpMessageId: null,
          etherealPreviewUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbState.emails.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = dbState.emails.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        dbState.emails.set(where.id, updated);
        return updated;
      }),
    },
    outboxEvent: {
      createMany: vi.fn(async ({ data }: any) => {
        for (const item of data) {
          dbState.outbox.push({
            id: `outbox-${dbState.outbox.length + 1}`,
            ...item,
            attempts: 0,
            availableAt: new Date(),
            createdAt: new Date(),
          });
        }
        return { count: data.length };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `outbox-${dbState.outbox.length + 1}`,
          ...data,
          attempts: 0,
          availableAt: new Date(),
          createdAt: new Date(),
        };
        dbState.outbox.push(row);
        return row;
      }),
    },
  };

  return {
    prisma: {
      user: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id === userA.id) return userA;
          if (where.id === userB.id) return userB;
          return null;
        }),
      },
      emailSender: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.id === senderA.id ? senderA : null,
        ),
      },
      emailCampaign: {
        findUnique: vi.fn(async ({ where }: any) => {
          if (where.id) return dbState.campaigns.get(where.id) ?? null;
          if (where.userId_idempotencyKey) {
            for (const c of dbState.campaigns.values()) {
              if (
                c.userId === where.userId_idempotencyKey.userId &&
                c.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
              ) {
                return {
                  ...c,
                  scheduledEmails: [...dbState.emails.values()].filter(
                    (e) => e.campaignId === c.id,
                  ),
                };
              }
            }
          }
          return null;
        }),
        update: vi.fn(),
      },
      scheduledEmail: {
        findUnique: vi.fn(async ({ where }: any) => {
          const row = dbState.emails.get(where.id);
          return row ? { ...row, sender: senderA, campaign: dbState.campaigns.get(row.campaignId) } : null;
        }),
        groupBy: vi.fn(async () => []),
      },
      outboxEvent: {
        findMany: vi.fn(async () => dbState.outbox.filter((o) => o.status === 'pending')),
        update: vi.fn(async ({ where, data }: any) => {
          const item = dbState.outbox.find((o) => o.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        }),
      },
      $transaction: vi.fn(async (cb: any) => cb(txMock)),
      $disconnect: vi.fn(),
    },
    disconnectPrisma: vi.fn(),
  };
});

vi.mock('../src/config/redis', () => {
  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn().mockResolvedValue(0),
    eval: vi.fn(),
    quit: vi.fn(),
  };
  return {
    createRedisClient: vi.fn(() => mockRedis),
    getSharedRedisClient: vi.fn(() => mockRedis),
    closeSharedRedisClient: vi.fn(),
  };
});

const enqueuedJobs: any[] = [];
vi.mock('../src/queues/emailQueue', () => ({
  EMAIL_SEND_QUEUE_NAME: 'email-send-queue',
  ELASTICSEARCH_INDEX_QUEUE_NAME: 'elasticsearch-index-queue',
  emailSendQueue: {
    getJob: vi.fn(async (id: string) => enqueuedJobs.find((j) => j.jobId === id) ?? null),
    add: vi.fn(),
    close: vi.fn(),
  },
  elasticsearchIndexQueue: { add: vi.fn(), close: vi.fn() },
  enqueueEmailJob: vi.fn(async (data: any, scheduledAt: Date) => {
    enqueuedJobs.push({ jobId: data.emailId, data, scheduledAt });
  }),
  cancelEmailJob: vi.fn(async () => true),
  enqueueElasticsearchIndexJob: vi.fn(),
  closeQueues: vi.fn(),
}));

vi.mock('../src/queues/bullBoard', () => ({
  createBullBoardRouter: vi.fn(() => {
    const express = require('express');
    return express.Router();
  }),
}));

import { createApp } from '../src/app';
import { SESSION_COOKIE_NAME, signSessionToken } from '../src/middleware/auth';

describe('Email Scheduling API, Validation, Deduplication & Authorization', () => {
  const app = createApp();
  const tokenA = signSessionToken({ id: userA.id, email: userA.email });
  const tokenB = signSessionToken({ id: userB.id, email: userB.email });

  beforeEach(() => {
    dbState.campaigns.clear();
    dbState.emails.clear();
    dbState.outbox = [];
    enqueuedJobs.length = 0;
  });

  it('validates invalid email addresses and missing fields', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${tokenA}`])
      .send({
        subject: '',
        body: 'Hello',
        recipients: ['not-an-email'],
        startTime: '2026-12-01T10:00:00Z',
        senderId: 'sender-a',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('schedules campaign transactionally, deduplicates recipients, and enqueues BullMQ delayed jobs', async () => {
    const payload = {
      subject: 'Welcome to ReachInbox',
      body: 'Hello world!',
      recipients: ['User1@example.com', 'user1@example.com', 'user2@example.com'],
      startTime: '2026-12-01T10:00:00.000Z',
      delayBetweenEmails: 2000,
      hourlyLimit: 100,
      senderId: 'sender-a',
    };

    const res = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${tokenA}`])
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.scheduledCount).toBe(2);
    expect(res.body.data.duplicate).toBe(false);
    expect(dbState.emails.size).toBe(2);
    expect(enqueuedJobs).toHaveLength(2);

    // Verify calculated individual scheduledAt offsets (2000ms apart)
    const [first, second] = [...dbState.emails.values()];
    expect(second.scheduledAt.getTime() - first.scheduledAt.getTime()).toBe(2000);

    // Duplicate identical API request returns existing campaign without creating new jobs
    const dupRes = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${tokenA}`])
      .send(payload);

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.data.duplicate).toBe(true);
    expect(dbState.emails.size).toBe(2);
    expect(enqueuedJobs).toHaveLength(2);
  });

  it('prevents User B from accessing or cancelling User A emails and blocks cancelling sent emails', async () => {
    const emailId = 'email-protected-1';
    dbState.campaigns.set('camp-1', { id: 'camp-1', userId: userA.id });
    dbState.emails.set(emailId, {
      id: emailId,
      campaignId: 'camp-1',
      userId: userA.id,
      senderId: senderA.id,
      recipientEmail: 'target@example.com',
      subject: 'Test',
      body: 'Body',
      scheduledAt: new Date('2026-12-01T10:00:00Z'),
      status: 'sent',
    });

    const forbiddenRes = await request(app)
      .get(`/api/emails/${emailId}`)
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${tokenB}`]);
    expect(forbiddenRes.status).toBe(403);

    const cancelSentRes = await request(app)
      .post(`/api/emails/${emailId}/cancel`)
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${tokenA}`]);
    expect(cancelSentRes.status).toBe(409);
  });
});
