import { Router } from 'express';
import {
  cancelEmailHandler,
  getDashboardStatsHandler,
  getEmailByIdHandler,
  listEmailsQuerySchema,
  listScheduledEmailsHandler,
  listSentEmailsHandler,
  scheduleEmailSchema,
  scheduleEmailsHandler,
  searchEmailsHandler,
  searchEmailsQuerySchema,
} from '../controllers/emailController';
import { requireAuth } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';

const router = Router();

router.use(requireAuth);

router.post(
  '/schedule',
  validateRequest({ body: scheduleEmailSchema }),
  scheduleEmailsHandler,
);
router.get(
  '/scheduled',
  validateRequest({ query: listEmailsQuerySchema }),
  listScheduledEmailsHandler,
);
router.get(
  '/sent',
  validateRequest({ query: listEmailsQuerySchema }),
  listSentEmailsHandler,
);
router.get(
  '/search',
  validateRequest({ query: searchEmailsQuerySchema }),
  searchEmailsHandler,
);
router.get('/stats', getDashboardStatsHandler);
router.get('/:id', getEmailByIdHandler);
router.post('/:id/cancel', cancelEmailHandler);

export default router;
