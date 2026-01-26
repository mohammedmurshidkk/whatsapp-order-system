import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import { Order, OrderItemData, FulfillmentType } from '../types';
import { getBusinessById } from '../plugins/cake-cafe/services/menuService';
import { sendOrderNotification } from '../plugins/cake-cafe/services/orderService';

interface ManualOrderItem {
  name: string;
  quantity: number;
  size_or_weight?: string;
  unit_price?: number;
  custom_text?: string;
  delivery_date?: string;
  notes?: string;
  addons?: Array<{
    addon_name: string;
    quantity: number;
    unit_price?: number;
  }>;
}

interface ManualOrderRequest {
  sessionId?: string;
  customerPhone?: string;
  items: ManualOrderItem[];
  fulfillmentType: FulfillmentType;
  deliveryAddress?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryTime?: string;
  deliveryFee?: number;
  pickupOutletId?: string;
  pickupTime?: string;
  fulfillmentNotes?: string;
}

/**
 * Generate the next order number for a business
 */
async function generateOrderNumber(businessId: string): Promise<string> {
  const business = await getBusinessById(businessId);
  const prefix = business?.order_number_prefix || 'ORD';

  const today = new Date().toISOString().split('T')[0];
  const startOfDay = `${today}T00:00:00.000Z`;
  const endOfDay = `${today}T23:59:59.999Z`;

  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  if (error) {
    logger.error('Failed to count daily orders', error);
    return `${prefix}-${Date.now().toString().slice(-6)}`;
  }

  const nextNumber = (count || 0) + 1;
  const dateStr = today.slice(2).replace(/-/g, '');
  return `${prefix}-${dateStr}-${nextNumber}`;
}

/**
 * Get prefill data from an existing session for manual order creation
 */
export async function getOrderPrefill(req: AuthRequest, res: Response): Promise<void> {
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
          id,
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

    // Get session items with addons
    const { data: items } = await supabase
      .from('session_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    const itemsWithAddons = await Promise.all(
      (items || []).map(async (item) => {
        const { data: addons } = await supabase
          .from('session_item_addons')
          .select('*')
          .eq('session_item_id', item.id)
          .order('created_at', { ascending: true });

        return {
          ...item,
          addons: addons || [],
        };
      })
    );

    // Get available outlets for takeaway
    const { data: outlets } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, address, phone')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    res.status(200).json({
      customer: {
        id: (session.customers as any)?.id,
        phone: (session.customers as any)?.phone || '',
        name: (session.customers as any)?.name || '',
      },
      items: itemsWithAddons,
      fulfillment: {
        type: session.fulfillment_type || null,
        delivery_address: session.delivery_address || null,
        delivery_latitude: session.delivery_latitude || null,
        delivery_longitude: session.delivery_longitude || null,
        delivery_time: session.delivery_time || null,
        pickup_outlet_id: session.pickup_outlet_id || null,
        pickup_time: session.pickup_time || null,
        fulfillment_notes: session.fulfillment_notes || null,
        custom_delivery_fee: session.custom_delivery_fee || null,
      },
      outlets: outlets || [],
    });
  } catch (error) {
    logger.error('Failed to get order prefill', error);
    res.status(500).json({ error: 'Failed to get order prefill data' });
  }
}

/**
 * Create order manually - either from existing session or fresh
 */
export async function createManualOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body: ManualOrderRequest = req.body;

    // Validate required fields
    if (!body.items || body.items.length === 0) {
      res.status(400).json({ error: 'At least one item is required' });
      return;
    }

    if (!body.fulfillmentType) {
      res.status(400).json({ error: 'Fulfillment type is required' });
      return;
    }

    if (body.fulfillmentType === 'takeaway' && !body.pickupOutletId) {
      res.status(400).json({ error: 'Pickup outlet is required for takeaway' });
      return;
    }

    let customerId: string;
    let sessionId: string | null = body.sessionId || null;

    // If sessionId provided, verify it belongs to this business
    if (sessionId) {
      const { data: session } = await supabase
        .from('sessions')
        .select('id, customer_id, business_id')
        .eq('id', sessionId)
        .eq('business_id', businessId)
        .single();

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      customerId = session.customer_id;
    } else {
      // Fresh order - need customerPhone
      if (!body.customerPhone) {
        res.status(400).json({ error: 'Customer phone is required for fresh orders' });
        return;
      }

      // Normalize phone number
      const phone = body.customerPhone.replace(/\D/g, '');

      // Find or create customer
      let { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .eq('business_id', businessId)
        .single();

      if (!customer) {
        const { data: newCustomer, error: createError } = await supabase
          .from('customers')
          .insert({
            phone,
            business_id: businessId,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (createError || !newCustomer) {
          res.status(500).json({ error: 'Failed to create customer' });
          return;
        }

        customer = newCustomer;
      }

      customerId = customer.id;

      // Create a session for tracking
      const { data: newSession, error: sessionError } = await supabase
        .from('sessions')
        .insert({
          customer_id: customerId,
          business_id: businessId,
          status: 'completed',
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          total_items: body.items.length,
        })
        .select('id')
        .single();

      if (sessionError || !newSession) {
        res.status(500).json({ error: 'Failed to create session' });
        return;
      }

      sessionId = newSession.id;
    }

    // Calculate totals and prepare order items
    let totalAmount = 0;
    const orderItems: OrderItemData[] = body.items.map((item) => {
      const lineTotal = (item.unit_price || 0) * item.quantity;
      totalAmount += lineTotal;

      // Process addons
      const addons = (item.addons || []).map((addon) => {
        const addonTotal = (addon.unit_price || 0) * addon.quantity;
        totalAmount += addonTotal;

        return {
          addon_name: addon.addon_name,
          quantity: addon.quantity,
          unit_price: addon.unit_price || undefined,
          line_total: addonTotal || undefined,
        };
      });

      return {
        name: item.name,
        quantity: item.quantity,
        size_or_weight: item.size_or_weight || undefined,
        unit_price: item.unit_price || undefined,
        line_total: lineTotal || undefined,
        custom_text: item.custom_text || undefined,
        delivery_date: item.delivery_date || undefined,
        notes: item.notes || undefined,
        addons: addons.length > 0 ? addons : undefined,
      };
    });

    // Delivery fee
    const deliveryFee = body.fulfillmentType === 'delivery' ? (body.deliveryFee || 0) : 0;
    const grandTotal = totalAmount + deliveryFee;

    // Generate order number
    const orderNumber = await generateOrderNumber(businessId);

    // Build order summary text
    let orderSummary = `*Order Summary*\n`;
    orderSummary += '━━━━━━━━━━━━━━━━━━\n\n';

    orderItems.forEach((item, index) => {
      orderSummary += `${index + 1}. ${item.name}`;
      if (item.size_or_weight) orderSummary += ` (${item.size_or_weight})`;
      if (item.quantity > 1) orderSummary += ` x${item.quantity}`;
      if (item.unit_price) orderSummary += ` - ₹${item.line_total}`;
      orderSummary += '\n';

      if (item.addons) {
        item.addons.forEach((addon) => {
          orderSummary += `   + ${addon.addon_name}`;
          if (addon.quantity > 1) orderSummary += ` x${addon.quantity}`;
          if (addon.unit_price) orderSummary += ` - ₹${addon.line_total}`;
          orderSummary += '\n';
        });
      }

      if (item.custom_text) orderSummary += `   📝 "${item.custom_text}"\n`;
      if (item.delivery_date) orderSummary += `   📅 ${item.delivery_date}\n`;
      if (item.notes) orderSummary += `   ℹ️ ${item.notes}\n`;
    });

    orderSummary += '\n━━━━━━━━━━━━━━━━━━\n';
    orderSummary += `Total Items: ${orderItems.length}\n`;
    orderSummary += `Subtotal: ₹${totalAmount}\n`;
    if (deliveryFee > 0) orderSummary += `Delivery Fee: ₹${deliveryFee}\n`;
    orderSummary += `*Grand Total: ₹${grandTotal}*\n`;

    // Find earliest delivery date
    const deliveryDates = orderItems
      .map((item) => item.delivery_date)
      .filter((date): date is string => date !== undefined);
    const deliveryDate = deliveryDates.length > 0 ? deliveryDates[0] : null;

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        business_id: businessId,
        session_id: sessionId,
        customer_id: customerId,
        items: orderItems,
        total_items: orderItems.length,
        total_amount: grandTotal,
        delivery_fee: deliveryFee,
        order_summary: orderSummary,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        delivery_date: deliveryDate,
        fulfillment_type: body.fulfillmentType,
        delivery_address: body.deliveryAddress || null,
        delivery_latitude: body.deliveryLatitude || null,
        delivery_longitude: body.deliveryLongitude || null,
        delivery_time: body.deliveryTime || null,
        pickup_outlet_id: body.pickupOutletId || null,
        pickup_time: body.pickupTime || null,
        fulfillment_notes: body.fulfillmentNotes || null,
      })
      .select()
      .single();

    if (orderError || !order) {
      logger.error('Failed to create manual order', orderError);
      res.status(500).json({ error: 'Failed to create order' });
      return;
    }

    // Clear session items if from existing session
    if (body.sessionId) {
      await supabase
        .from('session_items')
        .delete()
        .eq('session_id', body.sessionId);

      // Mark session as completed and clear fulfillment data
      await supabase
        .from('sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          fulfillment_type: null,
          delivery_address: null,
          delivery_time: null,
          delivery_latitude: null,
          delivery_longitude: null,
          pickup_outlet_id: null,
          pickup_time: null,
          fulfillment_notes: null,
          custom_delivery_fee: null,
        })
        .eq('id', body.sessionId);
    }

    logger.info(`Manual order created: ${orderNumber} (ID: ${order.id}) by admin`);

    // Send notification
    await sendOrderNotification(order as Order);

    res.status(201).json({
      success: true,
      order: order as Order,
    });
  } catch (error) {
    logger.error('Failed to create manual order', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
}

/**
 * Get available outlets for manual order form
 */
export async function getOutlets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: outlets } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, address, phone')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    res.status(200).json({ outlets: outlets || [] });
  } catch (error) {
    logger.error('Failed to get outlets', error);
    res.status(500).json({ error: 'Failed to get outlets' });
  }
}
