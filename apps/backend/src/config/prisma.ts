import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

prisma.$on('error' as never, (event: unknown) => {
  logger.error({ err: event }, 'Prisma client error');
});

prisma.$on('warn' as never, (event: unknown) => {
  logger.warn({ warn: event }, 'Prisma client warning');
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
