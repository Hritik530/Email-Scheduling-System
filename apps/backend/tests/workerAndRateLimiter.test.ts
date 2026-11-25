import { EmailStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory atomic Redis simulator supporting Lua script semantics for:
 * - reserveSlot Lua
 * - releaseHourSlot Lua
 * - distributed locks (SET NX PX)
 */
const redisState = {
  kv: new Map<string, string>(),
  locks: new Map<string, string>(),
};

const mockRedisClient = {
  ping: vi.fn().mockResolvedValue('PONG'),
  get: vi.fn(async (k: string) => redisState.kv.get(k) ?? null),
  set: vi.fn(async (k: string, v: string, ...args: any[]) => {
    const isNx = args.includes('NX');
    if (isNx) {
      if (redisState.kv.has(k) || redisState.locks.has(k)) return null;
      if (k.startsWith('lock:')) {
        redisState.locks.set(k, v);
      } else {
        redisState.kv.set(k, v);
      }
      return 'OK';
    }
    redisState.kv.set(k, v);
    return 'OK';
  }),
  exists: vi.fn(async (k: string) => (redisState.locks.has(k) || redisState.kv.has(k) ? 1 : 0)),
  del: vi.fn(async (k: string) => {
    redisState.kv.delete(k);
    redisState.locks.delete(k);
    return 1;
  }),
  eval: vi.fn(async (script: string, _numKeys: number, ...args: string[]) => {
    // Release lock script
    if (script.includes('redis.call("DEL"')) {
      const [lockKey, token] = args;
      if (redisState.locks.get(lockKey) === token) {
        redisState.locks.delete(lockKey);
        return 1;
      }
      return 0;
    }

    // Release hour slot script
    if (script.includes('redis.call("DECR"')) {
      const [hourKey] = args;
      const cur = Number(redisState.kv.get(hourKey) ?? '0');
      if (cur > 0) {
        const next = cur - 1;
        redisState.kv.set(hourKey, String(next));
        return next;
      }
      return 0;
    }

    // Reserve slot script
    const [nextSlotKey, delayCursorKey, nowMsStr, minDelayStr, hourlyLimitStr, senderId] =
      args;
    const nowMs = Number(nowMsStr);
    const minDelayMs = Number(minDelayStr);
    const hourlyLimit = Number(hourlyLimitStr);
    const hourBucket = Math.floor(nowMs / 3600000);
    const hourKey = `rl:sender:${senderId}:hour:${hourBucket}`;
    const currentCount = Number(redisState.kv.get(hourKey) ?? '0');

    if (currentCount >= hourlyLimit) {
      let h = hourBucket + 1;
      let targetMs = h * 3600000;
      const stepMs = Math.max(minDelayMs, 50);
      while (h <= hourBucket + 168) {
        const actual = Number(redisState.kv.get(`rl:sender:${senderId}:hour:${h}`) ?? '0');
        const reservedKey = `rl:sender:${senderId}:reserved:${h}`;
        const reserved = Number(redisState.kv.get(reservedKey) ?? '0');
        if (actual + reserved < hourlyLimit) {
          redisState.kv.set(reservedKey, String(reserved + 1));
          targetMs = h * 3600000 + reserved * stepMs;
          break;
        }
        h += 1;
      }
      return ['HOURLY_LIMIT_REACHED', String(targetMs), String(currentCount), String(hourBucket)];
    }

    const nextSlot = Number(redisState.kv.get(nextSlotKey) ?? '0');
    if (nowMs < nextSlot) {
      const cursor = Number(redisState.kv.get(delayCursorKey) ?? '0');
      let candidate = Math.max(nextSlot, cursor);
      if (candidate <= nowMs) candidate = nextSlot;
      const stepMs = Math.max(minDelayMs, 50);
      redisState.kv.set(delayCursorKey, String(candidate + stepMs));
      return ['MIN_DELAY', String(candidate), String(currentCount), String(hourBucket)];
    }

    const newCount = currentCount + 1;
    redisState.kv.set(hourKey, String(newCount));
    if (minDelayMs > 0) {
      redisState.kv.set(nextSlotKey, String(nowMs + minDelayMs));
    }
    return ['ALLOWED', String(nowMs), String(newCount), String(hourBucket)];
  }),
  quit: vi.fn(),
};

vi.mock('../src/config/redis', () => ({
  createRedisClient: vi.fn(() => mockRedisClient),
  getSharedRedisClient: vi.fn(() => mockRedisClient),
  closeSharedRedisClient: vi.fn(),
}));

const emailRecords = new Map<string, any>();
const outboxRecords: any[] = [];
const slackIntegrations = new Map<string, any>();

vi.mock('../src/config/prisma', () => {
  const txObj = {
    scheduledEmail: {
      update: vi.fn(async ({ where, data }: any) => {
        const rec = emailRecords.get(where.id);
        const updated = { ...rec, ...data, updatedAt: new Date() };
        emailRecords.set(where.id, updated);
        return updated;
      }),
    },
    outboxEvent: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ob-${outboxRecords.length + 1}`, ...data, attempts: 0, availableAt: new Date() };
        outboxRecords.push(row);
        return row;
      }),
    },
  };

  return {
    prisma: {
      scheduledEmail: {
        findUnique: vi.fn(async ({ where }: any) => emailRecords.get(where.id) ?? null),
        findMany: vi.fn(async ({ where }: any) => {
          const all = [...emailRecords.values()];
          return all.filter((e) => {
            if (where?.status && e.status !== where.status) return false;
            if (where?.updatedAt?.lt && !(e.updatedAt < where.updatedAt.lt)) return false;
            return true;
          });
        }),
        update: txObj.scheduledEmail.update,
        updateMany: vi.fn(async ({ where, data }: any) => {
          const rec = emailRecords.get(where.id);
          if (!rec) return { count: 0 };
          if (where.status?.in && !where.status.in.includes(rec.status)) return { count: 0 };
          if (typeof where.status === 'string' && rec.status !== where.status) return { count: 0 };
          const updated = {
            ...rec,
            ...data,
            attempts: data.attempts?.increment ? rec.attempts + data.attempts.increment : rec.attempts,
            updatedAt: new Date(),
          };
          emailRecords.set(where.id, updated);
          return { count: 1 };
        }),
        groupBy: vi.fn(async ({ where }: any) => {
          const counts = new Map<string, number>();
          for (const e of emailRecords.values()) {
            if (e.campaignId === where.campaignId) {
              counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
            }
          }
          return [...counts.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
        }),
      },
      emailCampaign: {
        update: vi.fn(),
      },
      slackIntegration: {
        findUnique: vi.fn(async ({ where }: any) => slackIntegrations.get(where.userId) ?? null),
      },
      outboxEvent: {
        findMany: vi.fn(async () => outboxRecords.filter((o) => o.status === 'pending')),
        update: vi.fn(async ({ where, data }: any) => {
          const item = outboxRecords.find((o) => o.id === where.id);
          if (item) Object.assign(item, data);
          return item;
        }),
      },
      $transaction: vi.fn(async (cb: any) => cb(txObj)),
      $disconnect: vi.fn(),
    },
    disconnectPrisma: vi.fn(),
  };
});

const smtpSentCalls: Array<{ to: string }> = [];
let smtpShouldFail = false;

vi.mock('../src/integrations/smtp/smtpService', () => ({
  sendEmailViaSmtp: vi.fn(async (payload: any) => {
    if (smtpShouldFail) {
      throw new Error('SMTP 421 Temporary service unavailable');
    }
    smtpSentCalls.push({ to: payload.to });
    return {
      messageId: `<msg-${smtpSentCalls.length}@ethereal.email>`,
      etherealPreviewUrl: `https://ethereal.email/message/${smtpSentCalls.length}`,
    };
  }),
}));

const slackWebhooksPosted: string[] = [];
vi.mock('axios', () => ({
  default: {
    post: vi.fn(async (_url: string, body: { text: string }) => {
      slackWebhooksPosted.push(body.text);
      return { data: { ok: true } };
    }),
  },
}));

const queueJobs = new Map<string, any>();
vi.mock('../src/queues/emailQueue', () => ({
  EMAIL_SEND_QUEUE_NAME: 'email-send-queue',
  ELASTICSEARCH_INDEX_QUEUE_NAME: 'elasticsearch-index-queue',
  emailSendQueue: {
    getJob: vi.fn(async (id: string) => queueJobs.get(id) ?? null),
    add: vi.fn(),
    close: vi.fn(),
  },
  elasticsearchIndexQueue: { add: vi.fn(), close: vi.fn() },
  enqueueEmailJob: vi.fn(async (data: any, scheduledAt: Date) => {
    queueJobs.set(data.emailId, { id: data.emailId, data, scheduledAt });
  }),
  cancelEmailJob: vi.fn(),
  enqueueElasticsearchIndexJob: vi.fn(),
  closeQueues: vi.fn(),
}));

import { encryptSecret } from '../src/utils/crypto';
import { reconcileDatabaseAndQueuesOnStartup } from '../src/services/outboxService';
import { reserveSendSlot } from '../src/services/rateLimiterService';
import { processEmailJob } from '../src/workers/emailProcessor';

function seedEmail(id: string, overrides: Partial<any> = {}) {
  const email = {
    id,
    campaignId: 'camp-1',
    userId: 'user-1',
    senderId: 'sender-1',
    recipientEmail: `${id}@example.com`,
    subject: 'Test Subject',
    body: 'Test Body',
    scheduledAt: new Date(),
    sentAt: null,
    status: EmailStatus.scheduled,
    attempts: 0,
    errorMessage: null,
    smtpMessageId: null,
    etherealPreviewUrl: null,
    idempotencyKey: `idem-${id}`,
    updatedAt: new Date(),
    sender: {
      id: 'sender-1',
      email: 'sender@ethereal.email',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
      smtpUsername: 'sender@ethereal.email',
      encryptedSmtpPassword: encryptSecret('pass'),
      isActive: true,
    },
    campaign: {
      id: 'camp-1',
      delayBetweenEmails: 0,
      hourlyLimit: 100,
    },
    ...overrides,
  };
  emailRecords.set(id, email);
  return email;
}

describe('Worker Processing, Rate Limiting, Slack Alerts, Load & Recovery', () => {
  beforeEach(() => {
    redisState.kv.clear();
    redisState.locks.clear();
    emailRecords.clear();
    outboxRecords.length = 0;
    slackIntegrations.clear();
    smtpSentCalls.length = 0;
    slackWebhooksPosted.length = 0;
    queueJobs.clear();
    smtpShouldFail = false;
  });

  it('sends scheduled email via SMTP, records Ethereal preview URL, and enforces idempotency', async () => {
    seedEmail('email-1');
    const fakeJob = {
      data: { emailId: 'email-1', campaignId: 'camp-1', userId: 'user-1', senderId: 'sender-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any;

    const result = await processEmailJob(fakeJob);
    expect(result.outcome).toBe('sent');
    expect(result.etherealPreviewUrl).toContain('https://ethereal.email/message/');
    expect(emailRecords.get('email-1').status).toBe('sent');
    expect(smtpSentCalls).toHaveLength(1);

    // Re-running job for already-sent email must NOT send duplicate SMTP message
    const secondRun = await processEmailJob(fakeJob);
    expect(secondRun.outcome).toBe('skipped');
    expect(secondRun.reason).toBe('sent');
    expect(smtpSentCalls).toHaveLength(1);
  });

  it('releases hourly quota on SMTP failure and retries until final attempt marks failed', async () => {
    smtpShouldFail = true;
    seedEmail('email-fail-1');

    const attempt1Job = {
      data: { emailId: 'email-fail-1', campaignId: 'camp-1', userId: 'user-1', senderId: 'sender-1' },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as any;

    await expect(processEmailJob(attempt1Job)).rejects.toThrow('SMTP 421');
    expect(emailRecords.get('email-fail-1').status).toBe('scheduled');

    // Hourly bucket count must have been released back to 0
    const hourBucket = Math.floor(Date.now() / 3600000);
    expect(redisState.kv.get(`rl:sender:sender-1:hour:${hourBucket}`)).toBe('0');

    // Verify immediate retry before MIN_EMAIL_DELAY_MS is throttled by min_delay
    const throttledRun = await processEmailJob({ ...attempt1Job, attemptsMade: 1 });
    expect(throttledRun.outcome).toBe('rescheduled');
    expect(throttledRun.reason).toBe('min_delay');

    // Advance past min_delay window and run final attempt
    redisState.kv.delete('rl:sender:sender-1:next_slot');
    const finalJob = { ...attempt1Job, attemptsMade: 1 };
    await expect(processEmailJob(finalJob)).rejects.toThrow('SMTP 421');
    expect(emailRecords.get('email-fail-1').status).toBe('failed');
  });

  it('reschedules excess jobs on hourly limit and sends exactly one Slack notification per window', async () => {
    slackIntegrations.set('user-1', {
      userId: 'user-1',
      teamId: 'T123',
      teamName: 'Acme',
      isConnected: true,
      encryptedAccessToken: encryptSecret('xoxb-test'),
      encryptedWebhookUrl: encryptSecret('https://hooks.slack.com/services/T123/B123/XYZ'),
    });

    const hourBucket = Math.floor(Date.now() / 3600000);
    redisState.kv.set(`rl:sender:sender-1:hour:${hourBucket}`, '2');

    seedEmail('email-rl-1', { campaign: { id: 'camp-1', delayBetweenEmails: 0, hourlyLimit: 2 } });
    seedEmail('email-rl-2', { campaign: { id: 'camp-1', delayBetweenEmails: 0, hourlyLimit: 2 } });

    const moveToDelayed = vi.fn();

    for (const id of ['email-rl-1', 'email-rl-2']) {
      const job = {
        data: { emailId: id, campaignId: 'camp-1', userId: 'user-1', senderId: 'sender-1' },
        attemptsMade: 0,
        opts: { attempts: 3 },
        moveToDelayed,
      } as any;

      await expect(processEmailJob(job, 'token-1')).rejects.toThrow();
      expect(emailRecords.get(id).status).toBe('scheduled');
      expect(emailRecords.get(id).scheduledAt.getTime()).toBeGreaterThan(Date.now());
    }

    // Two jobs hit limit, but Slack idempotency ensures only ONE notification sent
    expect(moveToDelayed).toHaveBeenCalledTimes(2);
    expect(slackWebhooksPosted).toHaveLength(1);
    expect(slackWebhooksPosted[0]).toContain('Email Rate Limit Reached');
    expect(slackWebhooksPosted[0]).toContain('sender@ethereal.email');
  });

  it('handles 1000 concurrent email slot reservations across multiple workers without duplicates or exceeding hourly limit', async () => {
    const baseTime = Date.UTC(2026, 11, 1, 10, 0, 0);
    const hourlyLimit = 100;
    const minDelayMs = 0;

    // Simulate 1000 jobs hitting the distributed rate limiter simultaneously across concurrent workers
    const results = await Promise.all(
      Array.from({ length: 1000 }).map((_, idx) =>
        reserveSendSlot('sender-load', minDelayMs, hourlyLimit, baseTime + idx),
      ),
    );

    const allowed = results.filter((r) => r.status === 'ALLOWED');
    const rescheduled = results.filter((r) => r.status === 'HOURLY_LIMIT_REACHED');

    expect(allowed).toHaveLength(100);
    expect(rescheduled).toHaveLength(900);

    // Verify all 900 excess jobs are distributed into future hour windows (>= 11:00 UTC)
    const futureHours = new Set(
      rescheduled.map((r) => Math.floor((r as any).retryAtMs / 3600000)),
    );
    expect(futureHours.size).toBe(9);
  });

  it('recovers unpublished outbox events and stale processing rows on restart without re-enqueuing sent emails', async () => {
    seedEmail('email-sent', { status: EmailStatus.sent });
    seedEmail('email-stale', {
      status: EmailStatus.processing,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    seedEmail('email-pending', { status: EmailStatus.scheduled });

    outboxRecords.push({
      id: 'ob-recover-1',
      aggregateType: 'EMAIL_JOB',
      aggregateId: 'email-pending',
      eventType: 'ENQUEUE_EMAIL',
      status: 'pending',
      attempts: 0,
      availableAt: new Date(Date.now() - 1000),
      payload: {
        emailId: 'email-pending',
        campaignId: 'camp-1',
        userId: 'user-1',
        senderId: 'sender-1',
        scheduledAt: new Date().toISOString(),
      },
    });

    const stats = await reconcileDatabaseAndQueuesOnStartup();
    expect(stats.flushedOutbox).toBe(1);
    expect(stats.recoveredStale).toBe(1);
    expect(emailRecords.get('email-stale').status).toBe('scheduled');
    expect(queueJobs.has('email-pending')).toBe(true);
    expect(queueJobs.has('email-stale')).toBe(true);
    expect(queueJobs.has('email-sent')).toBe(false);
  });
});
