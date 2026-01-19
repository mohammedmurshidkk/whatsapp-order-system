import { IRouter, Router } from 'express';
import { aggregateItemStats } from '../controllers/superadminUsageController';
import { superadminMiddleware } from '../middleware/auth';

const router: IRouter = Router();

router.use(superadminMiddleware);

router.post('/aggregate-item-stats', aggregateItemStats);

export default router;
