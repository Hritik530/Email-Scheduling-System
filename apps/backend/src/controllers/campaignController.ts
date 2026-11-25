import { NextFunction, Request, Response } from 'express';
import { EmailStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { sendSuccess } from '../utils/httpResponse';

export async function listCampaignsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaigns = await prisma.emailCampaign.findMany({
      where: { userId: req.user!.id },
      include: {
        sender: { select: { id: true, email: true } },
        _count: { select: { scheduledEmails: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    sendSuccess(res, { campaigns });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: String(req.params.id) },
      include: {
        sender: { select: { id: true, email: true } },
        _count: { select: { scheduledEmails: true } },
      },
    });

    if (!campaign) {
      throw new NotFoundError('Campaign not found');
    }

    if (campaign.userId !== req.user!.id) {
      throw new ForbiddenError('You do not have access to this campaign');
    }

    sendSuccess(res, { campaign });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: String(req.params.id) },
      select: { id: true, userId: true, status: true },
    });

    if (!campaign) {
      throw new NotFoundError('Campaign not found');
    }

    if (campaign.userId !== req.user!.id) {
      throw new ForbiddenError('You do not have access to this campaign');
    }

    const grouped = await prisma.scheduledEmail.groupBy({
      by: ['status'],
      where: { campaignId: campaign.id },
      _count: { _all: true },
    });

    const stats: Record<EmailStatus, number> = {
      scheduled: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const row of grouped) {
      stats[row.status] = row._count._all;
    }

    const total =
      stats.scheduled + stats.processing + stats.sent + stats.failed + stats.cancelled;

    sendSuccess(res, {
      campaignId: campaign.id,
      status: campaign.status,
      total,
      ...stats,
    });
  } catch (err) {
    next(err);
  }
}
