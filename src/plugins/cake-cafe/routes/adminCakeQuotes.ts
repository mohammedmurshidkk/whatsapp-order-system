import { IRouter, Router } from 'express';
import {
  listQuotes,
  getQuote,
  getPendingQuote,
  sendQuote,
  cancelQuoteHandler,
  getQuoteSummary,
  confirmTimeHandler,
} from '../controllers/adminCakeQuotesController';
import { authMiddleware } from '../../../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// List all quotes (with optional status filter)
router.get('/', listQuotes);

// Get pending quote for a session (for chat bubble)
router.get('/session/:sessionId/pending', getPendingQuote);

// Get single quote
router.get('/:id', getQuote);

// Get quote summary for admin
router.get('/:id/summary', getQuoteSummary);

// Mark quote as sent
router.post('/:id/send', sendQuote);

// Confirm time for custom cake (after customer provides time)
router.post('/:id/confirm-time', confirmTimeHandler);

// Cancel quote
router.post('/:id/cancel', cancelQuoteHandler);

export default router;
