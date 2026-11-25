import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const esIndexedDocs: any[] = [];
let esAvailable = true;

vi.mock('@elastic/elasticsearch', () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      ping: vi.fn(async () => esAvailable),
      indices: {
        exists: vi.fn(async () => {
          if (!esAvailable) throw new Error('ES connection refused');
          return true;
        }),
        create: vi.fn(),
      },
      index: vi.fn(async ({ document }: any) => {
        if (!esAvailable) throw new Error('ES unavailable');
        esIndexedDocs.push(document);
        return { result: 'created' };
      }),
      search: vi.fn(async ({ query }: any) => {
        if (!esAvailable) throw new Error('ES unavailable');
        const userFilter = query.bool.filter.find((f: any) => f.term?.userId);
        const userId = userFilter?.term?.userId;
        const matching = esIndexedDocs.filter((d) => d.userId === userId);
        return {
          hits: {
            total: { value: matching.length },
            hits: matching.map((d) => ({ _source: d })),
          },
        };
      }),
    })),
  };
});

const mockUser = {
  id: 'user-es-1',
  googleId: 'g-es-1',
  email: 'esuser@example.com',
  name: 'ES User',
  avatar: null,
};

vi.mock('../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => mockUser),
    },
    scheduledEmail: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [
        {
          id: 'fallback-email-1',
          userId: mockUser.id,
          campaignId: 'camp-1',
          recipientEmail: 'fallback@example.com',
          subject: 'Fallback Search Result',
          body: 'Hello from Postgres fallback',
          status: 'sent',
          scheduledAt: new Date(),
          sentAt: new Date(),
          createdAt: new Date(),
          sender: { email: 'sender@ethereal.email' },
        },
      ]),
    },
    slackIntegration: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => create),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $disconnect: vi.fn(),
  },
  disconnectPrisma: vi.fn(),
}));

vi.mock('../src/config/redis', () => {
  const store = new Map<string, string>();
  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => {
      store.delete(k);
      return 1;
    }),
    quit: vi.fn(),
  };
  return {
    createRedisClient: vi.fn(() => mockRedis),
    getSharedRedisClient: vi.fn(() => mockRedis),
    closeSharedRedisClient: vi.fn(),
  };
});

vi.mock('../src/queues/emailQueue', () => ({
  EMAIL_SEND_QUEUE_NAME: 'email-send-queue',
  ELASTICSEARCH_INDEX_QUEUE_NAME: 'elasticsearch-index-queue',
  emailSendQueue: { getJob: vi.fn(), add: vi.fn(), close: vi.fn() },
  elasticsearchIndexQueue: { add: vi.fn(), close: vi.fn() },
  closeQueues: vi.fn(),
}));

vi.mock('../src/queues/bullBoard', () => ({
  createBullBoardRouter: vi.fn(() => {
    const express = require('express');
    return express.Router();
  }),
}));

import { createApp } from '../src/app';
import { indexEmailDocument } from '../src/integrations/elasticsearch/elasticsearchService';
import { SESSION_COOKIE_NAME, signSessionToken } from '../src/middleware/auth';

describe('Elasticsearch Search & Fallback + Slack Integration Endpoints', () => {
  const app = createApp();
  const token = signSessionToken({ id: mockUser.id, email: mockUser.email });

  beforeEach(() => {
    esIndexedDocs.length = 0;
    esAvailable = true;
  });

  it('indexes email documents and searches scoped to authenticated userId', async () => {
    await indexEmailDocument({
      emailId: 'e1',
      userId: mockUser.id,
      campaignId: 'c1',
      senderEmail: 'sender@ethereal.email',
      recipientEmail: 'vip@example.com',
      subject: 'Product Launch',
      body: 'Join us!',
      status: 'sent',
      scheduledAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    await indexEmailDocument({
      emailId: 'e2',
      userId: 'other-user',
      campaignId: 'c2',
      senderEmail: 'sender@ethereal.email',
      recipientEmail: 'secret@other.com',
      subject: 'Confidential',
      body: 'Private',
      status: 'sent',
      scheduledAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/emails/search?q=Launch')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.engine).toBe('elasticsearch');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].emailId).toBe('e1');
  });

  it('gracefully falls back to PostgreSQL when Elasticsearch is unavailable', async () => {
    esAvailable = false;

    const res = await request(app)
      .get('/api/emails/search?q=Fallback')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.engine).toBe('postgres-fallback');
    expect(res.body.data.items[0].recipientEmail).toBe('fallback@example.com');
  });

  it('supports Slack OAuth connect URL generation, status, and disconnect', async () => {
    const connectRes = await request(app)
      .get('/api/slack/connect?mode=json')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

    expect(connectRes.status).toBe(200);
    expect(connectRes.body.data.url).toContain('https://slack.com/oauth/v2/authorize');

    const statusRes = await request(app)
      .get('/api/slack/status')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.connected).toBe(false);

    const disconnectRes = await request(app)
      .post('/api/slack/disconnect')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);
    expect(disconnectRes.status).toBe(200);
    expect(disconnectRes.body.data.connected).toBe(false);
  });
});
