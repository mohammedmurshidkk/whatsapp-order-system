import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  getCakeQuoteById,
  getCakeQuotesByBusiness,
  getPendingQuoteForSession,
  getAcceptedQuoteForSession,
  markQuoteAsSent,
  cancelQuote,
  formatQuoteSummaryForAdmin,
  confirmQuoteTime,
} from '../services/cakeQuoteService';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { getSessionWithItems } from '../services/sessionService';
import { generateOrderSummary } from '../services/orderService';
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
// Returns either:
// - type: 'price_confirmation' for pending quotes (admin needs to send price)
// - type: 'time_confirmation' for accepted quotes with unconfirmed time
// ============================================

export async function getPendingQuote(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;

    // First check for pending quote (price confirmation needed)
    const pendingQuote = await getPendingQuoteForSession(sessionId);

    if (pendingQuote) {
      // Verify quote belongs to this business
      if (pendingQuote.business_id !== businessId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          type: 'price_confirmation',
          id: pendingQuote.id,
          suggested_message: pendingQuote.suggested_message,
          suggested_price: pendingQuote.suggested_price,
          ai_analysis: pendingQuote.ai_analysis,
          image_url: pendingQuote.image_url,
          customer_weight: pendingQuote.customer_weight,
          customer_flavor: pendingQuote.customer_flavor,
          created_at: pendingQuote.created_at,
          expires_at: pendingQuote.expires_at,
        },
      });
      return;
    }

    // Check for accepted quote needing time confirmation
    const acceptedQuote = await getAcceptedQuoteForSession(sessionId);

    if (acceptedQuote && acceptedQuote.requested_delivery_time && !acceptedQuote.time_confirmed) {
      // Verify quote belongs to this business
      if (acceptedQuote.business_id !== businessId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          type: 'time_confirmation',
          id: acceptedQuote.id,
          image_url: acceptedQuote.image_url,
          final_price: acceptedQuote.final_price,
          requested_delivery_time: acceptedQuote.requested_delivery_time,
          requested_fulfillment_type: acceptedQuote.requested_fulfillment_type,
          customer_weight: acceptedQuote.customer_weight,
          customer_flavor: acceptedQuote.customer_flavor,
          created_at: acceptedQuote.created_at,
        },
      });
      return;
    }

    // No pending action
    res.status(200).json({ success: true, data: null });
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

// ============================================
// CONFIRM TIME FOR CUSTOM CAKE
// ============================================

export async function confirmTimeHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    // Get quote first to verify ownership and status
    const existingQuote = await getCakeQuoteById(id);
    if (!existingQuote) {
      res.status(404).json({ error: 'Quote not found' });
      return;
    }

    if (existingQuote.business_id !== businessId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (existingQuote.status !== 'accepted') {
      res.status(400).json({ error: `Quote must be accepted first (current: ${existingQuote.status})` });
      return;
    }

    if (!existingQuote.requested_delivery_time) {
      res.status(400).json({ error: 'No time request pending for this quote' });
      return;
    }

    if (existingQuote.time_confirmed) {
      res.status(400).json({ error: 'Time already confirmed' });
      return;
    }

    // Confirm the time
    const updatedQuote = await confirmQuoteTime(id);

    if (!updatedQuote) {
      res.status(500).json({ error: 'Failed to confirm time' });
      return;
    }

    // Send confirmation message to customer
    if (existingQuote.session_id && existingQuote.customer) {
      const session = await getSessionWithItems(existingQuote.session_id);
      if (session) {
        const fulfillmentType = existingQuote.requested_fulfillment_type || 'delivery';
        const timeStr = existingQuote.requested_delivery_time;

        // Generate order summary
        const summary = await generateOrderSummary(existingQuote.session_id, {
          includeCta: true,
          ctaMessage: '\nPlease review and reply *YES* to confirm your order.',
        });

        const confirmMsg = `✅ Great news! Your ${fulfillmentType} time has been confirmed: *${timeStr}*\n\n${summary}`;

        await sendWhatsAppMessage(existingQuote.customer.phone, confirmMsg);
        logger.info(`Time confirmation sent to customer: ${existingQuote.customer.phone}`);
      }
    }

    logger.info(`Time confirmed for quote: ${id}`);
    res.status(200).json({ success: true, data: updatedQuote });
  } catch (error) {
    logger.error('Failed to confirm time', error);
    res.status(500).json({ error: 'Failed to confirm time' });
  }
}
