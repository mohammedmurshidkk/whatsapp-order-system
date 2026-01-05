import { IRouter, Router } from 'express';
import {
  listSessions,
  getSessionDetail,
  toggleAiPause,
  sendManualMessage,
  approveDelivery,
  rejectDelivery,
  getPendingDeliveryApprovals,
} from '../controllers/adminSessionController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/', listSessions);
router.get('/pending-delivery-approvals', getPendingDeliveryApprovals);
router.get('/:sessionId', getSessionDetail);
router.patch('/:sessionId/ai-pause', toggleAiPause);
router.post('/:sessionId/message', sendManualMessage);
router.post('/:sessionId/approve-delivery', approveDelivery);
router.post('/:sessionId/reject-delivery', rejectDelivery);

export default router;
