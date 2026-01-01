import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  getCakeQuoteById,
  getCakeQuotesByBusiness,
  getPendingQuoteForSession,
  markQuoteAsSent,
  cancelQuote,
  formatQuoteSummaryForAdmin,
} from '../services/cakeQuoteService';
import { CakePriceQuoteStatus } from '../types';

// ============================================
// LIST QUOTES
// ============================================

export async function listQuotes(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = req.query.status as CakePriceQuoteStatus | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const { quotes, total } = await getCakeQuotesByBusiness(businessId, status, page, limit);

    res.status(200).json({
      success: true,
      data: quotes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Failed to list cake quotes', error);
    res.status(500).json({ error: 'Failed to fetch cake quotes' });
  }
}

// ============================================
// GET SINGLE QUOTE
// ============================================

export async function getQuote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const quote = await getCakeQuoteById(id);

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    // Verify quote belongs to this business
    if (quote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.status(200).json({ success: true, data: quote });
  } catch (error) {
    logger.error('Failed to get cake quote', error);
    res.status(500).json({ error: 'Failed to fetch cake quote' });
  }
}

// ============================================
// GET PENDING QUOTE FOR SESSION (for chat bubble)
// ============================================

export async function getPendingQuote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;
    const quote = await getPendingQuoteForSession(sessionId);

    if (!quote) {
      res.status(200).json({ success: true, data: null });
      return;
    }

    // Verify quote belongs to this business
    if (quote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: quote.id,
        suggested_message: quote.suggested_message,
        suggested_price: quote.suggested_price,
        ai_analysis: quote.ai_analysis,
        image_url: quote.image_url,
        customer_weight: quote.customer_weight,
        customer_flavor: quote.customer_flavor,
        created_at: quote.created_at,
        expires_at: quote.expires_at,
      },
    });
  } catch (error) {
    logger.error('Failed to get pending quote for session', error);
    res.status(500).json({ error: 'Failed to fetch pending quote' });
  }
}

// ============================================
// MARK QUOTE AS SENT
// ============================================

export async function sendQuote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const adminId = req.user?.id;

    if (!businessId || !adminId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { final_message, final_price } = req.body;

    // Get quote first to verify ownership
    const existingQuote = await getCakeQuoteById(id);
    if (!existingQuote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    if (existingQuote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (existingQuote.status !== 'pending') {
      res.status(400).json({ error: `Quote is already ${existingQuote.status}` });
      return;
    }

    const quote = await markQuoteAsSent(id, adminId, final_message, final_price);

    if (!quote) {
      res.status(500).json({ error: 'Failed to mark quote as sent' });
      return;
    }

    logger.info(`Cake quote marked as sent: ${id}`);
    res.status(200).json({ success: true, data: quote });
  } catch (error) {
    logger.error('Failed to send cake quote', error);
    res.status(500).json({ error: 'Failed to send cake quote' });
  }
}

// ============================================
// CANCEL QUOTE
// ============================================

export async function cancelQuoteHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const adminId = req.user?.id;

    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Get quote first to verify ownership
    const existingQuote = await getCakeQuoteById(id);
    if (!existingQuote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    if (existingQuote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (existingQuote.status !== 'pending') {
      res.status(400).json({ error: `Quote is already ${existingQuote.status}` });
      return;
    }

    const quote = await cancelQuote(id, adminId);

    if (!quote) {
      res.status(500).json({ error: 'Failed to cancel quote' });
      return;
    }

    logger.info(`Cake quote cancelled: ${id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to cancel cake quote', error);
    res.status(500).json({ error: 'Failed to cancel cake quote' });
  }
}

// ============================================
// GET QUOTE SUMMARY FOR ADMIN
// ============================================

export async function getQuoteSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const quote = await getCakeQuoteById(id);

    if (!quote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    if (quote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const summary = formatQuoteSummaryForAdmin(quote);
    res.status(200).json({ success: true, data: { summary, quote } });
  } catch (error) {
    logger.error('Failed to get quote summary', error);
    res.status(500).json({ error: 'Failed to fetch quote summary' });
  }
}
