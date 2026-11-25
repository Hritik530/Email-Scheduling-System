import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import {
  createSender,
  deleteSender,
  listSenders,
  provisionEtherealSender,
  updateSender,
  verifySenderSmtp,
} from '../services/senderService';
import { sendSuccess } from '../utils/httpResponse';

export const createSenderSchema = z.object({
  email: z.string().trim().email('Valid sender email is required'),
  smtpHost: z.string().trim().min(1, 'SMTP host is required'),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUsername: z.string().trim().min(1, 'SMTP username is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'),
  isActive: z.boolean().optional(),
});

export const updateSenderSchema = z.object({
  email: z.string().trim().email().optional(),
  smtpHost: z.string().trim().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUsername: z.string().trim().min(1).optional(),
  smtpPassword: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function listSendersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const senders = await listSenders(req.user!.id);
    sendSuccess(res, { senders });
  } catch (err) {
    next(err);
  }
}

export async function createSenderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sender = await createSender({
      userId: req.user!.id,
      ...req.body,
    });
    sendSuccess(res, { sender }, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateSenderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sender = await updateSender(req.user!.id, String(req.params.id), req.body);
    sendSuccess(res, { sender });
  } catch (err) {
    next(err);
  }
}

export async function deleteSenderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await deleteSender(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function verifySenderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await verifySenderSmtp(req.user!.id, String(req.params.id));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function provisionEtherealSenderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sender = await provisionEtherealSender(req.user!.id);
    sendSuccess(res, { sender }, 201);
  } catch (err) {
    next(err);
  }
}
