import axios from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';
import { getSharedRedisClient } from '../../config/redis';
import { decryptSecret, encryptSecret } from '../../utils/crypto';
import { AppError } from '../../utils/errors';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

export interface SlackOAuthResult {
  teamId: string;
  teamName: string;
  accessToken: string;
  channelId: string | null;
  channelName: string | null;
  webhookUrl: string | null;
}

export interface RateLimitSlackAlertInput {
  userId: string;
  senderId: string;
  senderEmail: string;
  campaignId: string;
  hourlyLimit: number;
  sentInWindow: number;
  hourBucket: number;
  reachedAt: Date;
  nextWindowAt: Date;
}

export function isSlackOAuthConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

export function buildSlackAuthUrl(state: string): string {
  if (!isSlackOAuthConfigured()) {
    throw new AppError(
      503,
      'SLACK_OAUTH_NOT_CONFIGURED',
      'Slack OAuth credentials (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET) are not configured on the server.',
    );
  }

  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: 'incoming-webhook,chat:write',
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });

  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeSlackCode(code: string): Promise<SlackOAuthResult> {
  if (!isSlackOAuthConfigured()) {
    throw new AppError(
      503,
      'SLACK_OAUTH_NOT_CONFIGURED',
      'Slack OAuth credentials are not configured.',
    );
  }

  const form = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: env.SLACK_REDIRECT_URI,
  });

  const res = await axios.post<{
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string; name: string };
    incoming_webhook?: { url: string; channel?: string; channel_id?: string };
  }>(SLACK_TOKEN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  if (!res.data.ok || !res.data.access_token || !res.data.team) {
    throw new AppError(
      502,
      'SLACK_OAUTH_ERROR',
      `Slack OAuth exchange failed: ${res.data.error || 'unknown_error'}`,
    );
  }

  return {
    teamId: res.data.team.id,
    teamName: res.data.team.name,
    accessToken: res.data.access_token,
    channelId: res.data.incoming_webhook?.channel_id ?? null,
    channelName: res.data.incoming_webhook?.channel ?? null,
    webhookUrl: res.data.incoming_webhook?.url ?? null,
  };
}

export async function saveSlackIntegration(userId: string, oauth: SlackOAuthResult) {
  return prisma.slackIntegration.upsert({
    where: { userId },
    update: {
      teamId: oauth.teamId,
      teamName: oauth.teamName,
      channelId: oauth.channelId,
      channelName: oauth.channelName,
      encryptedAccessToken: encryptSecret(oauth.accessToken),
      encryptedWebhookUrl: oauth.webhookUrl ? encryptSecret(oauth.webhookUrl) : null,
      isConnected: true,
    },
    create: {
      userId,
      teamId: oauth.teamId,
      teamName: oauth.teamName,
      channelId: oauth.channelId,
      channelName: oauth.channelName,
      encryptedAccessToken: encryptSecret(oauth.accessToken),
      encryptedWebhookUrl: oauth.webhookUrl ? encryptSecret(oauth.webhookUrl) : null,
      isConnected: true,
    },
  });
}

export async function sendRateLimitSlackNotification(
  input: RateLimitSlackAlertInput,
): Promise<boolean> {
  try {
    const integration = await prisma.slackIntegration.findUnique({
      where: { userId: input.userId },
    });

    // If Slack is not connected, continue scheduling without failing
    if (!integration || !integration.isConnected) {
      return false;
    }

    const redis = getSharedRedisClient();
    const idempotencyKey = `slack:ratelimit:notified:${input.senderId}:${input.hourBucket}`;
    const acquired = await redis.set(idempotencyKey, '1', 'EX', 7200, 'NX');
    if (acquired !== 'OK') {
      // Notification already sent for this sender in this hourly window
      return false;
    }

    const messageText = [
      '*Email Rate Limit Reached*',
      `*Sender:* ${input.senderEmail}`,
      `*Hourly Limit:* ${input.hourlyLimit}`,
      `*Emails Sent in Window:* ${input.sentInWindow}`,
      `*Campaign:* ${input.campaignId}`,
      `*Time Reached:* ${input.reachedAt.toISOString()}`,
      `*Action:* Remaining emails have been rescheduled to the next available window (${input.nextWindowAt.toISOString()}).`,
    ].join('\n');

    if (integration.encryptedWebhookUrl) {
      const webhookUrl = decryptSecret(integration.encryptedWebhookUrl);
      await axios.post(
        webhookUrl,
        { text: messageText },
        { timeout: 8000 },
      );
      logger.info(
        { userId: input.userId, senderId: input.senderId, hourBucket: input.hourBucket },
        'Sent Slack rate-limit notification via incoming webhook',
      );
      return true;
    }

    if (integration.channelId) {
      const accessToken = decryptSecret(integration.encryptedAccessToken);
      const res = await axios.post<{ ok: boolean; error?: string }>(
        SLACK_POST_MESSAGE_URL,
        {
          channel: integration.channelId,
          text: messageText,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        },
      );

      if (!res.data.ok) {
        throw new Error(`Slack chat.postMessage error: ${res.data.error ?? 'unknown'}`);
      }

      logger.info(
        { userId: input.userId, senderId: input.senderId, hourBucket: input.hourBucket },
        'Sent Slack rate-limit notification via chat.postMessage',
      );
      return true;
    }

    return false;
  } catch (err) {
    logger.error(
      { err: (err as Error).message, userId: input.userId, senderId: input.senderId },
      'Failed to deliver Slack rate-limit notification (non-fatal)',
    );
    return false;
  }
}
