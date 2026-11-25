import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUser = {
  id: 'user-1',
  googleId: 'google-sub-123',
  email: 'alice@example.com',
  name: 'Alice Example',
  avatar: 'https://example.com/avatar.png',
  createdAt: new Date(),
  updatedAt: new Date(),
};

vi.mock('../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
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
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    eval: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
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
  emailSendQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
    close: vi.fn(),
  },
  elasticsearchIndexQueue: {
    add: vi.fn(),
    close: vi.fn(),
  },
  enqueueEmailJob: vi.fn(),
  cancelEmailJob: vi.fn(),
  enqueueElasticsearchIndexJob: vi.fn(),
  closeQueues: vi.fn(),
}));

vi.mock('../src/integrations/google/googleOAuth', () => ({
  isGoogleOAuthConfigured: vi.fn(() => true),
  buildGoogleAuthUrl: vi.fn(
    (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  ),
  exchangeGoogleCodeForProfile: vi.fn(async () => ({
    sub: 'google-sub-123',
    email: 'alice@example.com',
    email_verified: true,
    name: 'Alice Example',
    picture: 'https://example.com/avatar.png',
  })),
}));

vi.mock('../src/queues/bullBoard', () => ({
  createBullBoardRouter: vi.fn(() => {
    const express = require('express');
    return express.Router();
  }),
}));

import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { SESSION_COOKIE_NAME, signSessionToken } from '../src/middleware/auth';

describe('Google OAuth & Session Authentication', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/auth/google sets state cookie and redirects to Google OAuth', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('reachinbox_google_oauth_state='))).toBe(true);
  });

  it('GET /api/auth/google/callback rejects mismatched OAuth state', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback?code=abc&state=wrong-state')
      .set('Cookie', ['reachinbox_google_oauth_state=expected-state']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?error=');
  });

  it('GET /api/auth/google/callback upserts user and issues HTTP-only session cookie', async () => {
    vi.mocked(prisma.user.upsert).mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/auth/google/callback?code=valid-code&state=matching-state')
      .set('Cookie', ['reachinbox_google_oauth_state=matching-state']);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/scheduled');
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
    expect(cookies.some((c) => c.includes('HttpOnly'))).toBe(true);
  });

  it('GET /api/auth/me returns authenticated user and /api/auth/logout clears cookie', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);
    const token = signSessionToken({ id: mockUser.id, email: mockUser.email });

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`${SESSION_COOKIE_NAME}=${token}`]);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe('alice@example.com');

    const logoutRes = await request(app).post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);
  });

  it('blocks unauthenticated access to protected APIs and Bull Board', async () => {
    const apiRes = await request(app).get('/api/emails/scheduled');
    expect(apiRes.status).toBe(401);

    const boardRes = await request(app).get('/admin/queues').set('Accept', 'application/json');
    expect(boardRes.status).toBe(401);
  });
});
