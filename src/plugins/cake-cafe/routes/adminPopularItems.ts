import { IRouter, Router } from 'express';
import { getPopularItems } from '../controllers/adminPopularItemsController';
import { authMiddleware } from '../../../middleware/auth';

const router: IRouter = Router();

router.use(authMiddleware);

router.get('/', getPopularItems);

export default router;
