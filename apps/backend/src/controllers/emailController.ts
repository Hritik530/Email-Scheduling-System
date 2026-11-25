import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { searchEmails } from '../integrations/elasticsearch/elasticsearchService';
import {
  cancelScheduledEmail,
  getDashboardSummary,
  getEmailDetail,
  listScheduledEmails,
  listSentEmails,
  scheduleEmails,
} from '../services/emailSchedulerService';
import { sendSuccess } from '../utils/httpResponse';

export const scheduleEmailSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(300),
  body: z.string().trim().min(1, 'Email body is required').max(100_000),
  recipients: z
    .array(z.string().trim().email('Invalid recipient email address'))
    .min(1, 'At least one recipient is required')
    .max(10_000, 'Maximum 10,000 recipients per request'),
  startTime: z.coerce.date(),
  delayBetweenEmails: z.coerce.number().int().min(0).max(3_600_000).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  senderId: z.string().trim().min(1, 'Sender ID is required'),
  idempotencyKey: z.string().trim().max(128).optional(),
});

export const listEmailsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export const searchEmailsQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function scheduleEmailsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const headerKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

    const result = await scheduleEmails({
      userId: req.user!.id,
      subject: req.body.subject,
      body: req.body.body,
      recipients: req.body.recipients,
      startTime: req.body.startTime,
      delayBetweenEmails: req.body.delayBetweenEmails,
      hourlyLimit: req.body.hourlyLimit,
      senderId: req.body.senderId,
      idempotencyKey: req.body.idempotencyKey ?? headerKey,
    });

    sendSuccess(
      res,
      {
        campaignId: result.campaign.id,
        status: result.campaign.status,
        startTime: result.campaign.startTime,
        delayBetweenEmails: result.campaign.delayBetweenEmails,
        hourlyLimit: result.campaign.hourlyLimit,
        scheduledCount: result.scheduledCount,
        duplicate: result.duplicate,
      },
      result.duplicate ? 200 : 201,
    );
  } catch (err) {
    next(err);
  }
}

export async function listScheduledEmailsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = req.query as unknown as z.infer<typeof listEmailsQuerySchema>;
    const result = await listScheduledEmails({
      userId: req.user!.id,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function listSentEmailsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = req.query as unknown as z.infer<typeof listEmailsQuerySchema>;
    const result = await listSentEmails({
      userId: req.user!.id,
      status: query.status,
      search: query.search,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function searchEmailsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = req.query as unknown as z.infer<typeof searchEmailsQuerySchema>;
    const result = await searchEmails({
      userId: req.user!.id,
      q: query.q,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getDashboardStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const summary = await getDashboardSummary(req.user!.id);
    sendSuccess(res, summary);
  } catch (err) {
    next(err);
  }
}

export async function getEmailByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const email = await getEmailDetail(req.user!.id, String(req.params.id));
    sendSuccess(res, { email });
  } catch (err) {
    next(err);
  }
}

export async function cancelEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const email = await cancelScheduledEmail(req.user!.id, String(req.params.id));
    sendSuccess(res, { email });
  } catch (err) {
    next(err);
  }
}
