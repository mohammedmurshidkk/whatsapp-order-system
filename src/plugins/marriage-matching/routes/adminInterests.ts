// src/plugins/marriage-matching/routes/adminInterests.ts
import { IRouter, Router } from 'express';
import { authMiddleware } from '../../../middleware/auth';
import { listInterests, updateInterest } from '../controllers/adminInterestController';

const router: IRouter = Router();

router.use(authMiddleware);
router.get('/', listInterests);
router.patch('/:id', updateInterest);

export default router;
