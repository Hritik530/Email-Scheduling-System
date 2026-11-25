import { Router } from 'express';
import {
  createSenderHandler,
  createSenderSchema,
  deleteSenderHandler,
  listSendersHandler,
  provisionEtherealSenderHandler,
  updateSenderHandler,
  updateSenderSchema,
  verifySenderHandler,
} from '../controllers/senderController';
import { requireAuth } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';

const router = Router();

router.use(requireAuth);

router.get('/', listSendersHandler);
router.post('/', validateRequest({ body: createSenderSchema }), createSenderHandler);
router.post('/ethereal', provisionEtherealSenderHandler);
router.post('/:id/verify', verifySenderHandler);
router.put('/:id', validateRequest({ body: updateSenderSchema }), updateSenderHandler);
router.delete('/:id', deleteSenderHandler);

export default router;
