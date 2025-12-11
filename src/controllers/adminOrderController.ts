import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';

// List orders with filters
export async function listOrders(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, search, page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Get business sessions first
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, customer_id, customers(phone)')
      .eq('business_id', businessId);

    if (!sessions || sessions.length === 0) {
      res.status(200).json({
        orders: [],
        pagination: { page: pageNum, limit: limitNum, total: 0 },
      });
      return;
    }

    const sessionIds = sessions.map(s => s.id);
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    // Build query
    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .in('session_id', sessionIds)
      .order('created_at', { ascending: false });

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: orders, error, count } = await query;

    if (error) {
      throw error;
    }

    // Filter by search (customer phone) - done in memory since phone is in related table
    let filteredOrders = orders || [];
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredOrders = filteredOrders.filter(order => {
        const session = sessionMap.get(order.session_id);
        const phone = (session?.customers as any)?.phone || '';
        return phone.includes(searchLower);
      });
    }

    // Enrich with customer phone
    const enrichedOrders = filteredOrders.map(order => {
      const session = sessionMap.get(order.session_id);
      return {
        id: order.id,
        order_number: order?.order_number,
        customer_phone: (session?.customers as any)?.phone || 'Unknown',
        items: order.items,
        total: order.total_amount,
        status: order.status,
        created_at: order.created_at,
        fulfillment_type: order.fulfillment_type,
        delivery_address: order.delivery_address,
      };
    });

    res.status(200).json({
      orders: enrichedOrders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
      },
    });
  } catch (error) {
    logger.error('Failed to list orders', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

// Get single order detail
export async function getOrderDetail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        sessions (
          id,
          business_id,
          customers (
            phone,
            name
          )
        )
      `)
      .eq('id', orderId)
      .single();

    if (error || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Verify order belongs to this business
    if ((order.sessions as any)?.business_id !== businessId) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.status(200).json({
      order: {
        ...order,
        customer_phone: (order.sessions as any)?.customers?.phone || 'Unknown',
        customer_name: (order.sessions as any)?.customers?.name || null,
      },
    });
  } catch (error) {
    logger.error('Failed to get order detail', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}

// Update order status
export async function updateOrderStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ['confirmed', 'processing', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', '),
      });
      return;
    }

    // Verify order belongs to this business
    const { data: order } = await supabase
      .from('orders')
      .select('id, session_id, sessions(business_id)')
      .eq('id', orderId)
      .single();

    if (!order || (order.sessions as any)?.business_id !== businessId) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Update status
    const { error } = await supabase
      .from('orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (error) {
      throw error;
    }

    logger.info(`Order ${orderId} status updated to ${status}`);

    res.status(200).json({ success: true, status });
  } catch (error) {
    logger.error('Failed to update order status', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
}
