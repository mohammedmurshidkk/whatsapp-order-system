// src/plugins/marriage-matching/routes/adminInterests.ts
import { Router } from 'express';
import { authMiddleware } from '../../../middleware/auth';
import { listInterests, updateInterest } from '../controllers/adminInterestController';

const router = Router();
router.use(authMiddleware);
router.get('/', listInterests);
router.patch('/:id', updateInterest);
export default router;
