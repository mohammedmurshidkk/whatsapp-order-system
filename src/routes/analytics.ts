import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';
import * as analyticsController from '../controllers/analyticsController';

const router: Router = Router();

// All analytics routes require authentication and analytics feature
router.use(authMiddleware);
router.use(requireFeature('analytics'));

router.get('/summary', analyticsController.getSummary);
router.get('/trends', analyticsController.getTrends);
router.get('/top-customers', analyticsController.getTopCustomers);
router.get('/realtime', analyticsController.getRealtime);
router.post('/refresh', analyticsController.refresh);

export default router;
