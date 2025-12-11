import { Router } from 'express';
import {
  listSessions,
  getSessionDetail,
  toggleAiPause,
  sendManualMessage,
} from '../controllers/adminSessionController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get('/', listSessions);
router.get('/:sessionId', getSessionDetail);
router.patch('/:sessionId/ai-pause', toggleAiPause);
router.post('/:sessionId/message', sendManualMessage);

export default router;
