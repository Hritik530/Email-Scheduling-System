import axios from 'axios';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

export interface GoogleUserProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function buildGoogleAuthUrl(state: string): string {
  if (!isGoogleOAuthConfigured()) {
    throw new AppError(
      503,
      'GOOGLE_OAUTH_NOT_CONFIGURED',
      'Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured on the server.',
    );
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCodeForProfile(code: string): Promise<GoogleUserProfile> {
  if (!isGoogleOAuthConfigured()) {
    throw new AppError(
      503,
      'GOOGLE_OAUTH_NOT_CONFIGURED',
      'Google OAuth credentials are not configured.',
    );
  }

  const tokenParams = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    grant_type: 'authorization_code',
  });

  const tokenRes = await axios.post<{ access_token: string }>(
    GOOGLE_TOKEN_URL,
    tokenParams.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    },
  );

  const accessToken = tokenRes.data.access_token;
  if (!accessToken) {
    throw new AppError(502, 'GOOGLE_TOKEN_ERROR', 'Google did not return an access token');
  }

  const profileRes = await axios.get<GoogleUserProfile>(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });

  return profileRes.data;
}
