import { Router } from 'express';
import { listOrders, getOrderDetail, updateOrderStatus } from '../controllers/adminOrderController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/', listOrders);
router.get('/:orderId', getOrderDetail);
router.patch('/:orderId/status', updateOrderStatus);

export default router;
