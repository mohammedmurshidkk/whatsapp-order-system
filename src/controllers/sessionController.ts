import { Request, Response } from 'express';
import {
  getSessionById,
  getSessionWithItems,
  pauseAI,
  resumeAI,
  getActiveSessionsForBusiness,
  getSessionByCustomerPhone,
} from '../services/sessionService';
import { getRecentMessages } from '../services/messageService';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';

// Get session details with items and messages
export async function getSessionDetails(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionWithItems(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify session belongs to this business
    if (session.business_id !== businessId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = await getRecentMessages(sessionId, 50);

    res.status(200).json({
      session,
      messages,
    });
  } catch (error) {
    logger.error('Failed to get session details', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}

// Pause AI for a session (human takeover)
export async function pauseSessionAI(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify session belongs to this business
    if (session.business_id !== businessId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const pausedBy = req.user?.email || 'Business Owner';
    await pauseAI(sessionId, pausedBy);

    res.status(200).json({
      success: true,
      message: 'AI paused. You can now chat directly with the customer.',
      sessionId,
    });
  } catch (error) {
    logger.error('Failed to pause AI', error);
    res.status(500).json({ error: 'Failed to pause AI' });
  }
}

// Resume AI for a session
export async function resumeSessionAI(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Verify session belongs to this business
    if (session.business_id !== businessId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await resumeAI(sessionId);

    res.status(200).json({
      success: true,
      message: 'AI resumed. Bot will now respond to customer messages.',
      sessionId,
    });
  } catch (error) {
    logger.error('Failed to resume AI', error);
    res.status(500).json({ error: 'Failed to resume AI' });
  }
}

// Get sessions for authenticated business (with optional filters)
// Query params: ?status=active|completed|expired|all (default: all)
//               ?page=1&limit=20
export async function getSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('sessions')
      .select(`
        id,
        status,
        ai_paused,
        total_items,
        last_message_at,
        created_at,
        fulfillment_type,
        customers (
          phone,
          name
        )
      `, { count: 'exact' })
      .eq('business_id', businessId)
      .order('last_message_at', { ascending: false });

    // Filter by status if provided (and not 'all')
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: sessions, error, count } = await query;

    if (error) {
      throw error;
    }

    const enrichedSessions = (sessions || []).map(session => ({
      id: session.id,
      customer_phone: (session.customers as any)?.phone || 'Unknown',
      customer_name: (session.customers as any)?.name || null,
      status: session.status,
      ai_paused: session.ai_paused,
      items_count: session.total_items,
      fulfillment_type: session.fulfillment_type,
      last_message_at: session.last_message_at,
      created_at: session.created_at,
    }));

    res.status(200).json({
      sessions: enrichedSessions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
      },
    });
  } catch (error) {
    logger.error('Failed to get sessions', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// Find session by customer phone (within authenticated business)
export async function findSessionByPhone(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { phone } = req.params;

    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    // Find session for this phone within this business
    const { data: session } = await supabase
      .from('sessions')
      .select(`
        *,
        customers (phone, name)
      `)
      .eq('business_id', businessId)
      .eq('status', 'active')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (!session || (session.customers as any)?.phone !== phone) {
      // Try to find by customer phone
      const { data: customerSession } = await supabase
        .from('sessions')
        .select(`
          *,
          customers!inner (phone, name)
        `)
        .eq('business_id', businessId)
        .eq('customers.phone', phone)
        .eq('status', 'active')
        .order('last_message_at', { ascending: false })
        .limit(1)
        .single();

      if (!customerSession) {
        res.status(404).json({ error: 'No active session found for this phone' });
        return;
      }

      const sessionWithItems = await getSessionWithItems(customerSession.id);
      const messages = await getRecentMessages(customerSession.id, 50);

      res.status(200).json({
        session: sessionWithItems,
        messages,
      });
      return;
    }

    const sessionWithItems = await getSessionWithItems(session.id);
    const messages = await getRecentMessages(session.id, 50);

    res.status(200).json({
      session: sessionWithItems,
      messages,
    });
  } catch (error) {
    logger.error('Failed to find session by phone', error);
    res.status(500).json({ error: 'Failed to find session' });
  }
}
