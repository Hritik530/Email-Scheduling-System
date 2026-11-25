import { prisma } from '../config/prisma';
import {
  createEtherealTestAccount,
  verifySmtpConnection,
} from '../integrations/smtp/smtpService';
import { encryptSecret } from '../utils/crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';

export interface CreateSenderInput {
  userId: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  isActive?: boolean;
}

export interface UpdateSenderInput {
  email?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  isActive?: boolean;
}

const senderPublicSelect = {
  id: true,
  userId: true,
  email: true,
  smtpHost: true,
  smtpPort: true,
  smtpUsername: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export async function listSenders(userId: string) {
  return prisma.emailSender.findMany({
    where: { userId },
    select: senderPublicSelect,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createSender(input: CreateSenderInput) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await prisma.emailSender.findUnique({
    where: {
      userId_email: {
        userId: input.userId,
        email: normalizedEmail,
      },
    },
  });

  if (existing) {
    throw new ConflictError('A sender with this email address already exists');
  }

  return prisma.emailSender.create({
    data: {
      userId: input.userId,
      email: normalizedEmail,
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpUsername: input.smtpUsername.trim(),
      encryptedSmtpPassword: encryptSecret(input.smtpPassword),
      isActive: input.isActive ?? true,
    },
    select: senderPublicSelect,
  });
}

export async function updateSender(userId: string, senderId: string, input: UpdateSenderInput) {
  const existing = await prisma.emailSender.findUnique({
    where: { id: senderId },
  });

  if (!existing) {
    throw new NotFoundError('Email sender not found');
  }

  if (existing.userId !== userId) {
    throw new ForbiddenError('You do not have permission to update this sender');
  }

  return prisma.emailSender.update({
    where: { id: senderId },
    data: {
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.smtpHost ? { smtpHost: input.smtpHost.trim() } : {}),
      ...(input.smtpPort !== undefined ? { smtpPort: input.smtpPort } : {}),
      ...(input.smtpUsername ? { smtpUsername: input.smtpUsername.trim() } : {}),
      ...(input.smtpPassword ? { encryptedSmtpPassword: encryptSecret(input.smtpPassword) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: senderPublicSelect,
  });
}

export async function deleteSender(userId: string, senderId: string) {
  const existing = await prisma.emailSender.findUnique({
    where: { id: senderId },
  });

  if (!existing) {
    throw new NotFoundError('Email sender not found');
  }

  if (existing.userId !== userId) {
    throw new ForbiddenError('You do not have permission to delete this sender');
  }

  const campaignCount = await prisma.emailCampaign.count({
    where: { senderId },
  });

  if (campaignCount > 0) {
    // Soft-deactivate instead of breaking FK constraints for historical campaigns
    return prisma.emailSender.update({
      where: { id: senderId },
      data: { isActive: false },
      select: senderPublicSelect,
    });
  }

  await prisma.emailSender.delete({ where: { id: senderId } });
  return { deleted: true, id: senderId };
}

export async function verifySenderSmtp(userId: string, senderId: string) {
  const sender = await prisma.emailSender.findUnique({
    where: { id: senderId },
  });

  if (!sender) {
    throw new NotFoundError('Email sender not found');
  }

  if (sender.userId !== userId) {
    throw new ForbiddenError('You do not have permission to verify this sender');
  }

  const verified = await verifySmtpConnection(sender);
  return { verified, senderId: sender.id, email: sender.email };
}

export async function provisionEtherealSender(userId: string) {
  const account = await createEtherealTestAccount();
  return createSender({
    userId,
    email: account.email,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpUsername: account.smtpUsername,
    smtpPassword: account.smtpPassword,
    isActive: true,
  });
}
