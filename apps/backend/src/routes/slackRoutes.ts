import { Router } from 'express';
import {
  disconnectSlackHandler,
  getSlackStatusHandler,
  handleSlackCallbackHandler,
  startSlackConnectHandler,
} from '../controllers/slackController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/connect', requireAuth, startSlackConnectHandler);
router.get('/callback', handleSlackCallbackHandler);
router.get('/status', requireAuth, getSlackStatusHandler);
router.post('/disconnect', requireAuth, disconnectSlackHandler);

export default router;
