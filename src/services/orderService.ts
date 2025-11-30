import { supabase } from '../config/database';
import { SessionItem, Order, AIItemResponse, OrderItemData, MenuItem, OrderItemAddonData, AddOn } from '../types';
import {
  getSessionWithItems,
  completeSession,
  updateSessionItemCount,
} from './sessionService';
import { searchMenuItem } from './menuService';
import { logger } from '../utils/logger';

// Default business ID (same as webhookController for now)
const DEFAULT_BUSINESS_ID = 'c3150207-4bf9-4ce4-8478-2e6369c46749';

// Helper to get price for an item based on size
function getItemPrice(menuItem: MenuItem, sizeOrWeight?: string | null): number | null {
  // If item has sizes, find matching size price
  if (menuItem.sizes && menuItem.sizes.length > 0) {
    if (sizeOrWeight) {
      const normalizedSize = sizeOrWeight.toLowerCase().trim();
      const matchedSize = menuItem.sizes.find(
        s => s.name.toLowerCase().includes(normalizedSize) ||
             normalizedSize.includes(s.name.toLowerCase())
      );
      if (matchedSize) {
        return matchedSize.price;
      }
    }
    // Default to first size if no match
    return menuItem.sizes[0].price;
  }

  // Otherwise return base price
  return menuItem.price;
}

export async function saveOrderItem(
  sessionId: string,
  item: AIItemResponse,
  businessId: string = DEFAULT_BUSINESS_ID
): Promise<SessionItem> {
  // 1. Get base item price
  let unitPrice: number | null = null;
  const menuItem = await searchMenuItem(businessId, item.name);
  if (menuItem) {
    unitPrice = getItemPrice(menuItem, item.size_or_weight);
    logger.info(`Price lookup: ${item.name} (${item.size_or_weight || 'default'}) = ₹${unitPrice}`);
  }

  // 2. Handle Add-ons
  let addOnsData: OrderItemAddonData[] | null = null;
  if (item.add_ons && item.add_ons.length > 0) {
    const { data: fetchedAddOns, error: addOnError } = await supabase
      .from('add_ons')
      .select('name, price')
      .eq('business_id', businessId)
      .in('name', item.add_ons);
    
    if (addOnError) {
      logger.error('Failed to fetch add-ons', addOnError);
    } else {
      addOnsData = fetchedAddOns as OrderItemAddonData[];
      logger.info(`Found ${addOnsData.length} valid add-ons for item.`);
    }
  }

  // 3. Save to session_items
  const { data, error } = await supabase
    .from('session_items')
    .insert({
      session_id: sessionId,
      item_name: item.name,
      quantity: item.quantity || 1,
      size_or_weight: item.size_or_weight || null,
      unit_price: unitPrice,
      custom_text: item.custom_text || null,
      delivery_date: item.delivery_date || null,
      notes: item.notes || null,
      ai_raw: item,
      created_at: new Date().toISOString(),
      add_ons: addOnsData, // Save fetched add-ons data
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save order item', error);
    throw new Error('Failed to save order item');
  }

  // Update session item count
  await updateSessionItemCount(sessionId);

  logger.info(`Order item saved: ${item.name} @ ₹${unitPrice || 'N/A'}`);
  return data as SessionItem;
}

export async function getSessionItems(sessionId: string): Promise<SessionItem[]> {
  const { data, error } = await supabase
    .from('session_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Failed to fetch session items', error);
    throw new Error('Failed to fetch session items');
  }

  return (data || []) as SessionItem[];
}

// Update item quantity in session
export async function updateSessionItemQuantity(
  sessionId: string,
  itemName: string,
  newQuantity: number,
  sizeOrWeight?: string
): Promise<boolean> {
  const normalizedName = itemName.toLowerCase().trim();

  // Find the item first
  const { data: items } = await supabase
    .from('session_items')
    .select('*')
    .eq('session_id', sessionId);

  if (!items || items.length === 0) return false;

  // Find matching item
  const matchingItem = items.find(item => {
    const nameMatch = item.item_name.toLowerCase().includes(normalizedName) ||
                      normalizedName.includes(item.item_name.toLowerCase());
    if (sizeOrWeight) {
      return nameMatch && item.size_or_weight?.toLowerCase() === sizeOrWeight.toLowerCase();
    }
    return nameMatch;
  });

  if (!matchingItem) return false;

  // Update quantity
  const { error } = await supabase
    .from('session_items')
    .update({ quantity: newQuantity })
    .eq('id', matchingItem.id);

  if (error) {
    logger.error('Failed to update item quantity', error);
    return false;
  }

  logger.info(`Updated ${itemName} quantity to ${newQuantity}`);
  return true;
}

// Remove item from session
export async function removeSessionItem(
  sessionId: string,
  itemName: string,
  sizeOrWeight?: string
): Promise<boolean> {
  const normalizedName = itemName.toLowerCase().trim();

  // Find the item first
  const { data: items } = await supabase
    .from('session_items')
    .select('*')
    .eq('session_id', sessionId);

  if (!items || items.length === 0) return false;

  // Find matching item
  const matchingItem = items.find(item => {
    const nameMatch = item.item_name.toLowerCase().includes(normalizedName) ||
                      normalizedName.includes(item.item_name.toLowerCase());
    if (sizeOrWeight) {
      return nameMatch && item.size_or_weight?.toLowerCase() === sizeOrWeight.toLowerCase();
    }
    return nameMatch;
  });

  if (!matchingItem) return false;

  // Delete the item
  const { error } = await supabase
    .from('session_items')
    .delete()
    .eq('id', matchingItem.id);

  if (error) {
    logger.error('Failed to remove item', error);
    return false;
  }

  // Update session item count
  await updateSessionItemCount(sessionId);

  logger.info(`Removed ${itemName} from session`);
  return true;
}

export async function generateOrderSummary(sessionId: string): Promise<string> {
  const session = await getSessionWithItems(sessionId);

  if (!session || session.items.length === 0) {
    return 'Your cart is empty. Just tell me what you would like to order!';
  }

  let summary = '📋 *Order Summary*\n';
  summary += '━━━━━━━━━━━━━━━━━━\n\n';

  let grandTotal = 0;

  session.items.forEach((item, index) => {
    let lineTotal = (item.unit_price || 0) * item.quantity;
    
    summary += `${index + 1}. ${item.item_name}`;
    if (item.size_or_weight) summary += ` (${item.size_or_weight})`;
    if (item.quantity > 1) summary += ` x${item.quantity}`;
    if (item.unit_price) summary += ` - ₹${item.unit_price * item.quantity}`;
    summary += '\n';

    // Display add-ons
    if (item.add_ons && item.add_ons.length > 0) {
      item.add_ons.forEach(addOn => {
        summary += `   + ${addOn.name} - ₹${addOn.price}\n`;
        lineTotal += addOn.price * item.quantity; // Add add-on price to line total
      });
    }

    grandTotal += lineTotal;

    if (item.custom_text) summary += `   📝 "${item.custom_text}"\n`;
    if (item.delivery_date) summary += `   📅 ${item.delivery_date}\n`;
    if (item.notes) summary += `   ℹ️ ${item.notes}\n`;

    summary += '\n';
  });

  summary += '━━━━━━━━━━━━━━━━━━\n';
  summary += `📦 Total Items: ${session.items.reduce((acc, item) => acc + item.quantity, 0)}\n`;
  summary += `💰 *Grand Total: ₹${grandTotal}*\n\n`;
  summary += 'Reply *YES* to confirm your order';

  return summary;
}

export async function createFinalOrder(sessionId: string): Promise<Order> {
  const session = await getSessionWithItems(sessionId);

  if (!session) throw new Error('Session not found');
  if (session.items.length === 0) throw new Error('No items in session');

  let totalAmount = 0;
  const orderItems: OrderItemData[] = session.items.map((item) => {
    let lineTotal = (item.unit_price || 0) * item.quantity;

    // Add cost of add-ons to line total
    if (item.add_ons) {
      item.add_ons.forEach(addOn => {
        lineTotal += addOn.price * item.quantity;
      });
    }
    
    totalAmount += lineTotal;

    return {
      name: item.item_name,
      quantity: item.quantity,
      size_or_weight: item.size_or_weight || undefined,
      unit_price: item.unit_price || undefined,
      line_total: lineTotal || undefined,
      custom_text: item.custom_text || undefined,
      delivery_date: item.delivery_date || undefined,
      notes: item.notes || undefined,
      add_ons: item.add_ons || undefined, // Carry over add-ons to final order
    };
  });

  const orderSummary = await generateOrderSummary(sessionId);

  const deliveryDates = session.items.map((item) => item.delivery_date).filter((date): date is string => date !== null);
  const deliveryDate = deliveryDates.length > 0 ? deliveryDates[0] : null;

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      session_id: sessionId,
      customer_id: session.customer_id,
      business_id: session.business_id,
      items: orderItems,
      total_items: session.items.reduce((acc, item) => acc + item.quantity, 0),
      total_amount: totalAmount,
      order_summary: orderSummary,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      delivery_date: deliveryDate,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create order', error);
    throw new Error('Failed to create order');
  }

  await completeSession(sessionId);
  logger.info(`Order created: ${order.id} - Total: ₹${totalAmount}`);
  await sendOrderNotification(order as Order);

  return order as Order;
}


export async function sendOrderNotification(order: Order): Promise<void> {
  const notificationMethod = process.env.BUSINESS_NOTIFICATION_METHOD || 'console';

  const notificationText = `
🔔 NEW ORDER RECEIVED
━━━━━━━━━━━━━━━━━━━━
Order ID: ${order.id.substring(0, 8)}
Customer ID: ${order.customer_id.substring(0, 8)}
Status: ${order.status}
Delivery Date: ${order.delivery_date || 'Not specified'}

${order.order_summary}
`;

  switch (notificationMethod) {
    case 'console':
    default:
      logger.info('ORDER NOTIFICATION:');
      console.log(notificationText);
      break;
    // Future: Add telegram, whatsapp notification methods
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error) {
    return null;
  }

  return data as Order;
}

export async function getCustomerOrders(customerId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to fetch customer orders', error);
    throw new Error('Failed to fetch customer orders');
  }

  return (data || []) as Order[];
}

// Cancel an order by ID (short ID or full UUID)
export async function cancelOrderById(
  orderId: string,
  customerId: string
): Promise<{ success: boolean; message: string; order?: Order }> {
  // orderId could be short (first 8 chars) or full UUID
  const isShortId = orderId.length <= 8;

  let query = supabase.from('orders').select('*');

  if (isShortId) {
    // Search by ID starting with the short ID
    query = query.ilike('id', `${orderId}%`);
  } else {
    query = query.eq('id', orderId);
  }

  const { data: orders, error: fetchError } = await query;

  if (fetchError || !orders || orders.length === 0) {
    return {
      success: false,
      message: `Order #${orderId} not found. Please check the order ID and try again.`,
    };
  }

  // If multiple matches (unlikely but possible), take first
  const order = orders[0] as Order;

  // Verify this order belongs to the customer
  if (order.customer_id !== customerId) {
    return {
      success: false,
      message: `Order #${orderId} not found. Please check the order ID and try again.`,
    };
  }

  // Check if order can be cancelled (only confirmed orders)
  if (order.status === 'cancelled') {
    return {
      success: false,
      message: `Order #${orderId.substring(0, 8)} is already cancelled.`,
    };
  }

  if (order.status === 'completed') {
    return {
      success: false,
      message: `Order #${orderId.substring(0, 8)} is already completed and cannot be cancelled.`,
    };
  }

  // Cancel the order
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      // @ts-ignore
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id);

  if (updateError) {
    logger.error('Failed to cancel order', updateError);
    return {
      success: false,
      message: 'Failed to cancel order. Please try again or contact us.',
    };
  }

  logger.info(`Order cancelled: ${order.id}`);

  return {
    success: true,
    message: `Order #${order.id.substring(0, 8)} has been cancelled successfully.`,
    order: { ...order, status: 'cancelled' },
  };
}

// Get order by short ID for a customer
export async function getOrderByShortId(
  shortId: string,
  customerId: string
): Promise<Order | null> {
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .ilike('id', `${shortId}%`);

  if (!orders || orders.length === 0) {
    return null;
  }

  return orders[0] as Order;
}
