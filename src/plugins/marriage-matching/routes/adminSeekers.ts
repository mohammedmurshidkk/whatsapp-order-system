// src/plugins/marriage-matching/routes/adminSeekers.ts
import { IRouter, Router } from 'express';
import { authMiddleware } from '../../../middleware/auth';
import { listSeekers, updateSeekerBlock } from '../controllers/adminSeekerController';

const router: IRouter = Router();

router.use(authMiddleware);
router.get('/', listSeekers);
router.patch('/:id', updateSeekerBlock);

export default router;
