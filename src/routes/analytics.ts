import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as analyticsController from '../controllers/analyticsController';

const router: Router = Router();

// All analytics routes require authentication
router.use(authMiddleware);

router.get('/summary', analyticsController.getSummary);
router.get('/trends', analyticsController.getTrends);
router.get('/top-customers', analyticsController.getTopCustomers);
router.get('/realtime', analyticsController.getRealtime);
router.post('/refresh', analyticsController.refresh);

export default router;
