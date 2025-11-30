import { Router } from 'express';
import {
  getSessionDetails,
  pauseSessionAI,
  resumeSessionAI,
  getActiveSessions,
  findSessionByPhone,
} from '../controllers/sessionController';

const router = Router();

// Get active sessions for a business
router.get('/business/:businessId/active', getActiveSessions);

// Find session by customer phone
router.get('/phone/:phone', findSessionByPhone);

// Get session details
router.get('/:sessionId', getSessionDetails);

// Pause AI (human takeover)
router.post('/:sessionId/pause', pauseSessionAI);

// Resume AI
router.post('/:sessionId/resume', resumeSessionAI);

export default router;
