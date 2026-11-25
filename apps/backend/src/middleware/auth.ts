import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AuthUser } from '../types/express';
import { UnauthorizedError } from '../utils/errors';

export const SESSION_COOKIE_NAME = 'reachinbox_session';

export interface SessionPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function signSessionToken(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, env.SESSION_SECRET, {
    expiresIn: '7d',
  });
}

export function verifySessionToken(token: string): SessionPayload {
  const decoded = jwt.verify(token, env.SESSION_SECRET);
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.email !== 'string') {
    throw new UnauthorizedError('Invalid session token');
  }
  return {
    sub: decoded.sub,
    email: decoded.email,
    iat: decoded.iat,
    exp: decoded.exp,
  };
}

export function extractTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (cookieToken) {
    return cookieToken;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Session user no longer exists');
    }

    req.user = user as AuthUser;
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      next(err);
      return;
    }
    next(new UnauthorizedError('Invalid or expired session'));
  }
}

export async function requireBullBoardAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      if (req.accepts('html')) {
        res.redirect(`${env.FRONTEND_URL}/login?error=auth_required`);
        return;
      }
      throw new UnauthorizedError('Authentication required to access Bull Board');
    }

    const payload = verifySessionToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, avatar: true },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid session');
    }

    req.user = user;
    next();
  } catch (err) {
    if (req.accepts('html')) {
      res.redirect(`${env.FRONTEND_URL}/login?error=invalid_session`);
      return;
    }
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError('Invalid session'));
  }
}
