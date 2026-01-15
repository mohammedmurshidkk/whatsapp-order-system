import { supabase } from '../config/database';
import { DeliveryBoy, Order } from '../types';
import { logger } from '../utils/logger';

// Availability window in hours (16h to be safe within Meta's 24h policy)
const AVAILABILITY_WINDOW_HOURS = 16;

/**
 * Create a new delivery boy
 */
export async function createDeliveryBoy(
  businessId: string,
  name: string,
  phone: string
): Promise<DeliveryBoy | null> {
  const { data, error } = await supabase
    .from('delivery_boys')
    .insert({
      business_id: businessId,
      name,
      phone,
      is_active: true,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create delivery boy', error);
    return null;
  }

  return data;
}

/**
 * Get all delivery boys for a business
 */
export async function getDeliveryBoys(businessId: string): Promise<DeliveryBoy[]> {
  const { data, error } = await supabase
    .from('delivery_boys')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to get delivery boys', error);
    return [];
  }

  return data || [];
}

/**
 * Get a single delivery boy by ID
 */
export async function getDeliveryBoyById(
  businessId: string,
  deliveryBoyId: string
): Promise<DeliveryBoy | null> {
  const { data, error } = await supabase
    .from('delivery_boys')
    .select('*')
    .eq('id', deliveryBoyId)
    .eq('business_id', businessId)
    .single();

  if (error) {
    logger.error('Failed to get delivery boy', error);
    return null;
  }

  return data;
}

/**
 * Update a delivery boy
 */
export async function updateDeliveryBoy(
  businessId: string,
  deliveryBoyId: string,
  updates: Partial<Pick<DeliveryBoy, 'name' | 'phone' | 'is_active'>>
): Promise<DeliveryBoy | null> {
  const { data, error } = await supabase
    .from('delivery_boys')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryBoyId)
    .eq('business_id', businessId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update delivery boy', error);
    return null;
  }

  return data;
}

/**
 * Delete a delivery boy
 */
export async function deleteDeliveryBoy(
  businessId: string,
  deliveryBoyId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('delivery_boys')
    .delete()
    .eq('id', deliveryBoyId)
    .eq('business_id', businessId);

  if (error) {
    logger.error('Failed to delete delivery boy', error);
    return false;
  }

  return true;
}

/**
 * Get available delivery boys (within 16h messaging window)
 *
 * Logic:
 * 1. Get all active delivery boys for the business
 * 2. For each delivery boy, find matching customer by phone
 * 3. Check if customer has session with last_message_at within 16h
 * 4. Return only those who are within the window
 */
export async function getAvailableDeliveryBoys(businessId: string): Promise<
  Array<DeliveryBoy & { last_active_at: string | null; is_available: boolean }>
> {
  // Get all active delivery boys for this business
  const { data: deliveryBoys, error: dbError } = await supabase
    .from('delivery_boys')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (dbError || !deliveryBoys) {
    logger.error('Failed to get delivery boys for availability check', dbError);
    return [];
  }

  const windowStart = new Date();
  windowStart.setHours(windowStart.getHours() - AVAILABILITY_WINDOW_HOURS);
  const windowStartISO = windowStart.toISOString();

  const results: Array<DeliveryBoy & { last_active_at: string | null; is_available: boolean }> = [];

  for (const deliveryBoy of deliveryBoys) {
    // Find customer record with matching phone for this business
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', deliveryBoy.phone)
      .single();

    if (!customer) {
      // No customer record = never messaged = not available
      results.push({
        ...deliveryBoy,
        last_active_at: null,
        is_available: false,
      });
      continue;
    }

    // Check for recent session activity
    const { data: session } = await supabase
      .from('sessions')
      .select('last_message_at')
      .eq('customer_id', customer.id)
      .eq('business_id', businessId)
      .gte('last_message_at', windowStartISO)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    if (session) {
      results.push({
        ...deliveryBoy,
        last_active_at: session.last_message_at,
        is_available: true,
      });
    } else {
      // Get their last message time even if outside window (for display)
      const { data: lastSession } = await supabase
        .from('sessions')
        .select('last_message_at')
        .eq('customer_id', customer.id)
        .eq('business_id', businessId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .single();

      results.push({
        ...deliveryBoy,
        last_active_at: lastSession?.last_message_at || null,
        is_available: false,
      });
    }
  }

  // Sort: available first, then by last_active_at desc
  results.sort((a, b) => {
    if (a.is_available && !b.is_available) return -1;
    if (!a.is_available && b.is_available) return 1;
    if (a.last_active_at && b.last_active_at) {
      return new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime();
    }
    return 0;
  });

  return results;
}

/**
 * Check if a specific delivery boy is available (within messaging window)
 */
export async function isDeliveryBoyAvailable(
  businessId: string,
  deliveryBoyId: string
): Promise<boolean> {
  const deliveryBoy = await getDeliveryBoyById(businessId, deliveryBoyId);
  if (!deliveryBoy || !deliveryBoy.is_active) {
    return false;
  }

  const windowStart = new Date();
  windowStart.setHours(windowStart.getHours() - AVAILABILITY_WINDOW_HOURS);
  const windowStartISO = windowStart.toISOString();

  // Find customer with matching phone
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('business_id', businessId)
    .eq('phone', deliveryBoy.phone)
    .single();

  if (!customer) {
    return false;
  }

  // Check for session within window
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('customer_id', customer.id)
    .eq('business_id', businessId)
    .gte('last_message_at', windowStartISO)
    .limit(1)
    .single();

  return !!session;
}

/**
 * Format order details for WhatsApp message to delivery boy
 */
export function formatOrderForDelivery(
  order: Order,
  customerPhone: string,
  customerName: string | null,
  adminNote?: string
): string {
  const lines: string[] = [];

  lines.push(`📦 *New Delivery Assignment*`);
  lines.push(`Order: *${order.order_number}*`);
  lines.push('');

  // Customer info
  lines.push(`👤 *Customer:* ${customerName || 'Guest'}`);
  lines.push(`📞 *Phone:* ${customerPhone}`);
  lines.push('');

  // Delivery location
  if (order.delivery_address) {
    lines.push(`📍 *Delivery Address:*`);
    lines.push(order.delivery_address);
    lines.push('');
  }

  // Delivery time
  if (order.delivery_time) {
    lines.push(`🕐 *Delivery Time:* ${order.delivery_time}`);
    lines.push('');
  }

  // Order items
  lines.push(`🛒 *Items:*`);
  if (order.items && order.items.length > 0) {
    for (const item of order.items) {
      const size = item.size_or_weight ? ` (${item.size_or_weight})` : '';
      lines.push(`• ${item.quantity}x ${item.name}${size}`);
      if (item.custom_text) {
        lines.push(`  ✍️ "${item.custom_text}"`);
      }
      if (item.addons && item.addons.length > 0) {
        for (const addon of item.addons) {
          lines.push(`  + ${addon.addon_name}`);
        }
      }
    }
  }
  lines.push('');

  // Total
  lines.push(`💰 *Total Amount:* ₹${order.total_amount}`);
  if (order.delivery_fee && order.delivery_fee > 0) {
    lines.push(`🚚 *Delivery Fee:* ₹${order.delivery_fee}`);
  }

  // Admin note
  if (adminNote) {
    lines.push('');
    lines.push(`📝 *Note from Admin:*`);
    lines.push(adminNote);
  }

  // Google Maps link if coordinates available
  if (order.delivery_latitude && order.delivery_longitude) {
    lines.push('');
    lines.push(`🗺️ *Location:*`);
    lines.push(`https://www.google.com/maps?q=${order.delivery_latitude},${order.delivery_longitude}`);
  }

  return lines.join('\n');
}

/**
 * Assign delivery boy to order
 */
export async function assignDeliveryToOrder(
  businessId: string,
  orderId: string,
  deliveryBoyId: string,
  assignedBy?: string,
  adminNote?: string
): Promise<{ success: boolean; error?: string }> {
  // Verify delivery boy exists and belongs to business
  const deliveryBoy = await getDeliveryBoyById(businessId, deliveryBoyId);
  if (!deliveryBoy) {
    return { success: false, error: 'Delivery boy not found' };
  }

  // Update order with delivery assignment
  const { error } = await supabase
    .from('orders')
    .update({
      delivery_boy_id: deliveryBoyId,
      delivery_assigned_at: new Date().toISOString(),
      delivery_assigned_by: assignedBy || null,
      delivery_admin_note: adminNote || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('business_id', businessId);

  if (error) {
    logger.error('Failed to assign delivery to order', error);
    return { success: false, error: 'Failed to update order' };
  }

  logger.info(`Order ${orderId} assigned to delivery boy ${deliveryBoy.name} (${deliveryBoyId})`);
  return { success: true };
}
