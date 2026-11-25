import { Router } from 'express';
import {
  getCurrentUser,
  handleGoogleCallback,
  logoutUser,
  startGoogleAuth,
} from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/google', startGoogleAuth);
router.get('/google/callback', handleGoogleCallback);
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', logoutUser);

export default router;
