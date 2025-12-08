import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';

// Get dashboard stats
export async function getStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const { data: sessions } = await supabase
  .from('sessions')
  .select('id')
  .eq('business_id', businessId)

  const sessionIds = sessions?.map(s => s.id) ?? []

    // Get all stats in parallel
    const [ordersResult, sessionsResult, pendingResult, revenueResult] = await Promise.all([
      // Orders today
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayISO)
        .in('session_id', sessionIds),

      // Active sessions
      supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'active'),

      // Pending orders
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed')
        .in('session_id', sessionIds),

      // Revenue today
      supabase
        .from('orders')
        .select('total_amount, session_id')
        .gte('created_at', todayISO)
        .neq('status', 'cancelled'),
    ]);

    // Calculate revenue for this business's orders
    let revenueToday = 0;
    if (revenueResult.data) {
      // Get session IDs for this business
      const { data: businessSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('business_id', businessId);

      const sessionIds = new Set(businessSessions?.map(s => s.id) || []);

      revenueToday = revenueResult.data
        .filter(order => sessionIds.has(order.session_id))
        .reduce((sum, order) => sum + (order.total_amount || 0), 0);
    }

    res.status(200).json({
      ordersToday: ordersResult.count || 0,
      activeSessions: sessionsResult.count || 0,
      pendingOrders: pendingResult.count || 0,
      revenueToday,
    });
  } catch (error) {
    logger.error('Failed to get dashboard stats', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
}

// Get recent orders for dashboard
export async function getRecentOrders(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 5;

    // Get business sessions first
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, customer_id, customers(phone)')
      .eq('business_id', businessId);

    if (!sessions || sessions.length === 0) {
      res.status(200).json({ orders: [] });
      return;
    }

    const sessionIds = sessions.map(s => s.id);
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    // Get recent orders
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, session_id, total_amount, status, created_at, total_items')
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    // Enrich with customer phone
    const enrichedOrders = (orders || []).map(order => {
      const session = sessionMap.get(order.session_id);
      return {
        id: order.id,
        customer_phone: (session?.customers as any)?.phone || 'Unknown',
        total: order.total_amount,
        status: order.status,
        items_count: order.total_items,
        created_at: order.created_at,
      };
    });

    res.status(200).json({ orders: enrichedOrders });
  } catch (error) {
    logger.error('Failed to get recent orders', error);
    res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
}

// Get recent active sessions for dashboard
export async function getRecentSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 5;

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(`
        id,
        status,
        ai_paused,
        total_items,
        last_message_at,
        created_at,
        customers (
          phone
        )
      `)
      .eq('business_id', businessId)
      .eq('status', 'active')
      .order('last_message_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const enrichedSessions = (sessions || []).map(session => ({
      id: session.id,
      customer_phone: (session.customers as any)?.phone || 'Unknown',
      status: session.status,
      ai_paused: session.ai_paused,
      items_count: session.total_items,
      last_message_at: session.last_message_at,
    }));

    res.status(200).json({ sessions: enrichedSessions });
  } catch (error) {
    logger.error('Failed to get recent sessions', error);
    res.status(500).json({ error: 'Failed to fetch recent sessions' });
  }
}
