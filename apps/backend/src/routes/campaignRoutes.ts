import { Router } from 'express';
import {
  getCampaignByIdHandler,
  getCampaignStatsHandler,
  listCampaignsHandler,
} from '../controllers/campaignController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', listCampaignsHandler);
router.get('/:id', getCampaignByIdHandler);
router.get('/:id/stats', getCampaignStatsHandler);

export default router;
