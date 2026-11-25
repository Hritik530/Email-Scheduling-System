import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { getSharedRedisClient } from '../config/redis';
import {
  buildSlackAuthUrl,
  exchangeSlackCode,
  isSlackOAuthConfigured,
  saveSlackIntegration,
} from '../integrations/slack/slackService';
import { sendSuccess } from '../utils/httpResponse';

const SLACK_STATE_PREFIX = 'oauth:slack:state:';

export async function startSlackConnectHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const authUrl = buildSlackAuthUrl(state);

    const redis = getSharedRedisClient();
    await redis.set(`${SLACK_STATE_PREFIX}${state}`, req.user!.id, 'EX', 600);

    if (req.query.mode === 'json') {
      sendSuccess(res, { url: authUrl });
      return;
    }

    res.redirect(authUrl);
  } catch (err) {
    if (!req.query.mode) {
      const msg = err instanceof Error ? err.message : 'Slack OAuth configuration error';
      res.redirect(`${env.FRONTEND_URL}/settings?slack=error&message=${encodeURIComponent(msg)}`);
      return;
    }
    next(err);
  }
}

export async function handleSlackCallbackHandler(req: Request, res: Response): Promise<void> {
  const errorParam = typeof req.query.error === 'string' ? req.query.error : null;
  if (errorParam) {
    res.redirect(
      `${env.FRONTEND_URL}/settings?slack=error&message=${encodeURIComponent(errorParam)}`,
    );
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code || !state) {
    res.redirect(
      `${env.FRONTEND_URL}/settings?slack=error&message=${encodeURIComponent('Missing Slack OAuth code or state')}`,
    );
    return;
  }

  try {
    const redis = getSharedRedisClient();
    const stateKey = `${SLACK_STATE_PREFIX}${state}`;
    const userId = await redis.get(stateKey);
    await redis.del(stateKey);

    if (!userId) {
      res.redirect(
        `${env.FRONTEND_URL}/settings?slack=error&message=${encodeURIComponent('Expired or invalid Slack OAuth state')}`,
      );
      return;
    }

    const oauthResult = await exchangeSlackCode(code);
    await saveSlackIntegration(userId, oauthResult);

    res.redirect(`${env.FRONTEND_URL}/settings?slack=connected`);
  } catch (err) {
    logger.error({ err }, 'Slack OAuth callback failed');
    const msg = err instanceof Error ? err.message : 'Failed to connect Slack';
    res.redirect(
      `${env.FRONTEND_URL}/settings?slack=error&message=${encodeURIComponent(msg)}`,
    );
  }
}

export async function getSlackStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const integration = await prisma.slackIntegration.findUnique({
      where: { userId: req.user!.id },
      select: {
        id: true,
        teamId: true,
        teamName: true,
        channelId: true,
        channelName: true,
        isConnected: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    sendSuccess(res, {
      configured: isSlackOAuthConfigured(),
      connected: Boolean(integration?.isConnected),
      integration: integration?.isConnected ? integration : null,
    });
  } catch (err) {
    next(err);
  }
}

export async function disconnectSlackHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await prisma.slackIntegration.updateMany({
      where: { userId: req.user!.id },
      data: { isConnected: false },
    });

    sendSuccess(res, { connected: false });
  } catch (err) {
    next(err);
  }
}
