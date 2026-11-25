import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import { elasticsearchIndexQueue, emailSendQueue } from '../queues/emailQueue';

export function createBullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(emailSendQueue),
      new BullMQAdapter(elasticsearchIndexQueue),
    ],
    serverAdapter,
  });

  return serverAdapter.getRouter() as Router;
}
