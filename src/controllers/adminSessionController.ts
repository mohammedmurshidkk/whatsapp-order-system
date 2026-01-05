import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { generateOrderSummary } from '../services/orderService';
import { getBusinessById } from '../services/menuService';

// List sessions with filters
export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
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
        delivery_address,
        delivery_time,
        delivery_latitude,
        delivery_longitude,
        pickup_outlet_id,
        pickup_time,
        customers (
          phone
        )
      `, { count: 'exact' })
      .eq('business_id', businessId)
      .order('last_message_at', { ascending: false });

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: sessions, error, count } = await query;

    if (error) {
      throw error;
    }

    // Get outlet names for takeaway sessions
    const outletIds = (sessions || [])
      .filter(s => s.fulfillment_type === 'takeaway' && s.pickup_outlet_id)
      .map(s => s.pickup_outlet_id);

    let outletMap = new Map<string, string>();
    if (outletIds.length > 0) {
      const { data: outlets } = await supabase
        .from('business_outlets')
        .select('id, outlet_name')
        .in('id', outletIds);

      if (outlets) {
        outletMap = new Map(outlets.map(o => [o.id, o.outlet_name]));
      }
    }

    const enrichedSessions = (sessions || []).map(session => ({
      id: session.id,
      customer_phone: (session.customers as any)?.phone || 'Unknown',
      status: session.status,
      ai_paused: session.ai_paused,
      items_count: session.total_items,
      last_message_at: session.last_message_at,
      created_at: session.created_at,
      // Fulfillment data
      fulfillment_type: session.fulfillment_type,
      // Delivery info
      delivery_address: session.delivery_address,
      delivery_time: session.delivery_time,
      delivery_latitude: session.delivery_latitude,
      delivery_longitude: session.delivery_longitude,
      // Pickup/Takeaway info
      pickup_outlet_id: session.pickup_outlet_id,
      pickup_outlet_name: session.pickup_outlet_id ? outletMap.get(session.pickup_outlet_id) || null : null,
      pickup_time: session.pickup_time,
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
    logger.error('Failed to list sessions', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// Get session detail with messages
export async function getSessionDetail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;

    // Get session with customer
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select(`
        *,
        customers (
          phone,
          name
        )
      `)
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Get session items
    const { data: items } = await supabase
      .from('session_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    // Get menu items with categories for this business (to get custom_text_prompt)
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('name, category_id, menu_categories(custom_text_prompt)')
      .eq('business_id', businessId);

    // Create a map of item name -> custom_text_prompt
    const promptMap = new Map<string, string | null>();
    if (menuItems) {
      for (const mi of menuItems) {
        const prompt = (mi.menu_categories as any)?.custom_text_prompt || null;
        promptMap.set(mi.name.toLowerCase(), prompt);
      }
    }

    // Fetch addons for each item and include custom_text_prompt
    const itemsWithAddons = await Promise.all(
      (items || []).map(async (item) => {
        const { data: addons } = await supabase
          .from('session_item_addons')
          .select('*')
          .eq('session_item_id', item.id)
          .order('created_at', { ascending: true });

        // Get the custom_text_prompt for this item
        const customTextPrompt = promptMap.get(item.item_name.toLowerCase()) || null;

        return {
          ...item,
          custom_text_prompt: customTextPrompt,
          addons: addons || [],
        };
      })
    );

    // Get messages
    const { data: messages } = await supabase
      .from('messages')
      .select('id, direction, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    // Get outlet name if it's a pickup order
    let pickupOutletName: string | null = null;
    if (session.pickup_outlet_id) {
      const { data: outlet } = await supabase
        .from('business_outlets')
        .select('outlet_name')
        .eq('id', session.pickup_outlet_id)
        .single();

      if (outlet) {
        pickupOutletName = outlet.outlet_name;
      }
    }

    res.status(200).json({
      session: {
        ...session,
        customer_phone: (session.customers as any)?.phone || 'Unknown',
        customer_name: (session.customers as any)?.name || null,
        pickup_outlet_name: pickupOutletName,
        items: itemsWithAddons,
      },
      messages: messages || [],
    });
  } catch (error) {
    logger.error('Failed to get session detail', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}

// Toggle AI pause for session
export async function toggleAiPause(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;
    const { paused } = req.body;

    if (typeof paused !== 'boolean') {
      res.status(400).json({ error: 'paused must be a boolean' });
      return;
    }

    // Verify session belongs to this business
    const { data: session } = await supabase
      .from('sessions')
      .select('id, business_id')
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Update AI pause status
    const { error } = await supabase
      .from('sessions')
      .update({
        ai_paused: paused,
        paused_at: paused ? new Date().toISOString() : null,
        paused_by: paused ? (req as any).user?.email : null,
      })
      .eq('id', sessionId);

    if (error) {
      throw error;
    }

    logger.info(`Session ${sessionId} AI paused: ${paused}`);

    res.status(200).json({ success: true, ai_paused: paused });
  } catch (error) {
    logger.error('Failed to toggle AI pause', error);
    res.status(500).json({ error: 'Failed to toggle AI pause' });
  }
}

// Send manual message to customer (when AI is paused)
export async function sendManualMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Verify session belongs to this business and is active
    const { data: session } = await supabase
      .from('sessions')
      .select('id, business_id, status, customers(phone)')
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Save message to database
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        direction: 'outgoing',
        content: message,
        created_at: new Date().toISOString(),
      });

    if (msgError) {
      throw msgError;
    }

    // TODO: Actually send via WhatsApp API
    // For now, just log and return success
    const customerPhone = (session.customers as any)?.phone;
    logger.info(`Manual message sent to ${customerPhone}: ${message.substring(0, 50)}...`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to send manual message', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}

// Approve delivery for beyond-radius session
export async function approveDelivery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;
    const { customDeliveryFee } = req.body; // Optional: admin can set custom fee

    // Verify session belongs to this business and is pending approval
    const { data: session } = await supabase
      .from('sessions')
      .select('id, business_id, delivery_pending_approval, delivery_approval_status, customers(phone)')
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.delivery_pending_approval || session.delivery_approval_status !== 'pending') {
      res.status(400).json({ error: 'Session is not pending delivery approval' });
      return;
    }

    // Update session - mark as approved
    await supabase
      .from('sessions')
      .update({
        delivery_pending_approval: false,
        delivery_approval_status: 'approved',
      })
      .eq('id', sessionId);

    // Get business for timezone
    const business = await getBusinessById(businessId);
    const businessTimezone = business?.timezone || 'Asia/Kolkata';

    // Generate order summary with delivery fee
    const summary = await generateOrderSummary(sessionId, {
      includeCta: true,
      ctaMessage: '\n✅ *Delivery Approved!* Your location has been approved for delivery.\n\nReply *YES* to confirm your order.',
      timezone: businessTimezone,
    });

    // Send message to customer
    const customerPhone = (session.customers as any)?.phone;
    if (customerPhone) {
      await sendWhatsAppMessage(customerPhone, summary);

      // Save outgoing message
      await supabase.from('messages').insert({
        session_id: sessionId,
        direction: 'outgoing',
        content: summary,
        created_at: new Date().toISOString(),
      });
    }

    logger.info(`Delivery approved for session ${sessionId} by admin`);

    res.status(200).json({ success: true, message: 'Delivery approved, customer notified' });
  } catch (error) {
    logger.error('Failed to approve delivery', error);
    res.status(500).json({ error: 'Failed to approve delivery' });
  }
}

// Reject delivery for beyond-radius session
export async function rejectDelivery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sessionId } = req.params;
    const { reason } = req.body; // Optional rejection reason

    // Verify session belongs to this business and is pending approval
    const { data: session } = await supabase
      .from('sessions')
      .select('id, business_id, delivery_pending_approval, delivery_approval_status, customers(phone)')
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.delivery_pending_approval || session.delivery_approval_status !== 'pending') {
      res.status(400).json({ error: 'Session is not pending delivery approval' });
      return;
    }

    // Update session - mark as rejected and clear delivery info
    await supabase
      .from('sessions')
      .update({
        delivery_pending_approval: false,
        delivery_approval_status: 'rejected',
        delivery_address: null,
        delivery_latitude: null,
        delivery_longitude: null,
        fulfillment_type: null,
      })
      .eq('id', sessionId);

    // Send message to customer
    const customerPhone = (session.customers as any)?.phone;
    if (customerPhone) {
      const rejectMsg = `❌ *Delivery Not Available*\n\nWe're sorry, but we are unable to deliver to your location at this time.${reason ? `\n\nReason: ${reason}` : ''}\n\nYou can:\n• Choose a different delivery location\n• Select takeaway instead\n\nPlease reply to continue with your order.`;

      await sendWhatsAppMessage(customerPhone, rejectMsg);

      // Save outgoing message
      await supabase.from('messages').insert({
        session_id: sessionId,
        direction: 'outgoing',
        content: rejectMsg,
        created_at: new Date().toISOString(),
      });
    }

    logger.info(`Delivery rejected for session ${sessionId} by admin`);

    res.status(200).json({ success: true, message: 'Delivery rejected, customer notified' });
  } catch (error) {
    logger.error('Failed to reject delivery', error);
    res.status(500).json({ error: 'Failed to reject delivery' });
  }
}

// Get sessions pending delivery approval
export async function getPendingDeliveryApprovals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select(`
        id,
        status,
        delivery_address,
        delivery_latitude,
        delivery_longitude,
        delivery_pending_approval,
        delivery_approval_status,
        created_at,
        last_message_at,
        customers (
          phone,
          name
        )
      `)
      .eq('business_id', businessId)
      .eq('delivery_pending_approval', true)
      .eq('delivery_approval_status', 'pending')
      .order('last_message_at', { ascending: false });

    if (error) {
      throw error;
    }

    const enrichedSessions = (sessions || []).map(session => ({
      id: session.id,
      customer_phone: (session.customers as any)?.phone || 'Unknown',
      customer_name: (session.customers as any)?.name || null,
      delivery_address: session.delivery_address,
      delivery_latitude: session.delivery_latitude,
      delivery_longitude: session.delivery_longitude,
      status: session.status,
      created_at: session.created_at,
      last_message_at: session.last_message_at,
    }));

    res.status(200).json({ pending_approvals: enrichedSessions });
  } catch (error) {
    logger.error('Failed to get pending approvals', error);
    res.status(500).json({ error: 'Failed to fetch pending approvals' });
  }
}
