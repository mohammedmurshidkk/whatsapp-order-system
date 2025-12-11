import { Router } from 'express';
import { getStats, getRecentOrders, getRecentSessions } from '../controllers/dashboardController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/stats', getStats);
router.get('/recent-orders', getRecentOrders);
router.get('/recent-sessions', getRecentSessions);

export default router;
