import { IRouter, Router } from 'express';
import {
  getOrderPrefill,
  createManualOrder,
  getOutlets,
} from '../controllers/adminOrderController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// Get prefill data from existing session
router.get('/prefill/:sessionId', getOrderPrefill);

// Get available outlets for order form
router.get('/outlets', getOutlets);

// Create manual order
router.post('/manual', createManualOrder);

export default router;
