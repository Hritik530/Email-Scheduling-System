import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import {
  buildGoogleAuthUrl,
  exchangeGoogleCodeForProfile,
} from '../integrations/google/googleOAuth';
import { SESSION_COOKIE_NAME, signSessionToken } from '../middleware/auth';
import { sendSuccess } from '../utils/httpResponse';

const OAUTH_STATE_COOKIE = 'reachinbox_google_oauth_state';

function cookieBaseOptions() {
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function startGoogleAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    const authUrl = buildGoogleAuthUrl(state);

    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...cookieBaseOptions(),
      maxAge: 10 * 60 * 1000,
    });

    if (req.query.mode === 'json') {
      sendSuccess(res, { url: authUrl });
      return;
    }

    res.redirect(authUrl);
  } catch (err) {
    if (!req.query.mode) {
      const msg = err instanceof Error ? err.message : 'Google OAuth error';
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(msg)}`);
      return;
    }
    next(err);
  }
}

export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  const errorParam = typeof req.query.error === 'string' ? req.query.error : null;
  if (errorParam) {
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(errorParam)}`);
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;

  res.clearCookie(OAUTH_STATE_COOKIE, cookieBaseOptions());

  if (!code || !state || !expectedState || state !== expectedState) {
    logger.warn({ hasCode: Boolean(code), stateMatch: state === expectedState }, 'Invalid Google OAuth state');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Invalid OAuth state. Please try again.')}`);
    return;
  }

  try {
    const profile = await exchangeGoogleCodeForProfile(code);

    if (!profile.email || !profile.sub) {
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Google account did not return an email address.')}`);
      return;
    }

    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      update: {
        email: profile.email.toLowerCase(),
        name: profile.name || profile.email,
        avatar: profile.picture ?? null,
      },
      create: {
        googleId: profile.sub,
        email: profile.email.toLowerCase(),
        name: profile.name || profile.email,
        avatar: profile.picture ?? null,
      },
    });

    const token = signSessionToken({ id: user.id, email: user.email });
    res.cookie(SESSION_COOKIE_NAME, token, {
      ...cookieBaseOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${env.FRONTEND_URL}/scheduled`);
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent('Google sign-in failed. Please verify OAuth configuration.')}`);
  }
}

export function getCurrentUser(req: Request, res: Response): void {
  sendSuccess(res, { user: req.user });
}

export function logoutUser(_req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieBaseOptions());
  sendSuccess(res, { loggedOut: true });
}
