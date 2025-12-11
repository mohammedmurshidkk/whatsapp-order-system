import { Router } from 'express';
import {
  getSessionDetails,
  pauseSessionAI,
  resumeSessionAI,
  getSessions,
  findSessionByPhone,
} from '../controllers/sessionController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get sessions for authenticated business
// Query params: ?status=active|completed|expired|all (default: all)
//               ?page=1&limit=20
// Examples:
//   GET /api/sessions              → all sessions
//   GET /api/sessions?status=active → only active sessions
//   GET /api/sessions?status=completed&page=2&limit=10
router.get('/', getSessions);

// Find session by customer phone
router.get('/phone/:phone', findSessionByPhone);

// Get session details
router.get('/:sessionId', getSessionDetails);

// Pause AI (human takeover)
router.post('/:sessionId/pause', pauseSessionAI);

// Resume AI
router.post('/:sessionId/resume', resumeSessionAI);

export default router;
