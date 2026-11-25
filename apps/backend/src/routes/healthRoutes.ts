import { Router } from 'express';
import { getRuntimeConfigHandler, healthCheckHandler } from '../controllers/healthController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', healthCheckHandler);
router.get('/config', requireAuth, getRuntimeConfigHandler);

export default router;
