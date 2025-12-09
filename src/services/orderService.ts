import { supabase } from '../config/database';
import { SessionItem, Order, AIItemResponse, OrderItemData, MenuItem, Business } from '../types';
import {
  getSessionWithItems,
  completeSession,
  updateSessionItemCount,
} from './sessionService';
import { searchMenuItem, getBusinessById } from './menuService';
import { formatDeliveryTime, formatDateForDisplay } from './fulfillmentService';
import { logger } from '../utils/logger';

/**
 * Generate the next order number for a business
 * Format: PREFIX-N (e.g., "OKS-1", "OKS-2")
 * N resets daily and is unique per business per day
 */
async function generateOrderNumber(businessId: string): Promise<string> {
  // Get business prefix
  const business = await getBusinessById(businessId);
  const prefix = business?.order_number_prefix || 'ORD';

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  const startOfDay = `${today}T00:00:00.000Z`;
  const endOfDay = `${today}T23:59:59.999Z`;

  // Count orders for this business today
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  if (error) {
    logger.error('Failed to count daily orders', error);
    // Fallback: use timestamp-based number
    return `${prefix}-${Date.now().toString().slice(-6)}`;
  }

  const nextNumber = (count || 0) + 1;
  const orderNumber = `${prefix}-${nextNumber}`;

  logger.info(`Generated order number: ${orderNumber} for business ${businessId}`);
  return orderNumber;
}

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
  businessId: string
): Promise<SessionItem> {
  // Lookup menu item to get price
  let unitPrice: number | null = null;
  const menuItem = await searchMenuItem(businessId, item.name);
  if (menuItem) {
    unitPrice = getItemPrice(menuItem, item.size_or_weight);
    logger.info(`Price lookup: ${item.name} (${item.size_or_weight || 'default'}) = ₹${unitPrice}`);
  }

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

// Generate order summary - can optionally include CTA message
export async function generateOrderSummary(
  sessionId: string,
  options: { includeCta?: boolean; ctaMessage?: string; timezone?: string } = {}
): Promise<string> {
  const { includeCta = false, ctaMessage = 'Reply *YES* to confirm your order', timezone = 'Asia/Kolkata' } = options;

  const session = await getSessionWithItems(sessionId);

  if (!session || session.items.length === 0) {
    return 'No items in your order yet.';
  }

  let summary = '📋 *Order Summary*\n';
  summary += '━━━━━━━━━━━━━━━━━━\n\n';

  let grandTotal = 0;

  session.items.forEach((item, index) => {
    const lineTotal = (item.unit_price || 0) * item.quantity;
    grandTotal += lineTotal;

    summary += `${index + 1}. ${item.item_name}`;

    if (item.size_or_weight) {
      summary += ` (${item.size_or_weight})`;
    }

    if (item.quantity > 1) {
      summary += ` x${item.quantity}`;
    }

    // Show price
    if (item.unit_price) {
      if (item.quantity > 1) {
        summary += `\n   ₹${item.unit_price} × ${item.quantity} = ₹${lineTotal}`;
      } else {
        summary += ` - ₹${item.unit_price}`;
      }
    }

    summary += '\n';

    // Show add-ons
    if (item.addons && item.addons.length > 0) {
      item.addons.forEach((addon) => {
        const addonTotal = (addon.unit_price || 0) * addon.quantity;
        grandTotal += addonTotal;

        summary += `   + ${addon.addon_name}`;

        if (addon.quantity > 1) {
          summary += ` x${addon.quantity}`;
        }

        if (addon.unit_price !== null && addon.unit_price > 0) {
          if (addon.quantity > 1) {
            summary += ` - ₹${addon.unit_price} × ${addon.quantity} = ₹${addonTotal}`;
          } else {
            summary += ` - ₹${addon.unit_price}`;
          }
        } else {
          summary += ' - FREE';
        }

        summary += '\n';
      });
    }

    if (item.custom_text) {
      summary += `   📝 "${item.custom_text}"\n`;
    }

    if (item.delivery_date) {
      // Format delivery date using timezone
      summary += `   📅 ${formatDateForDisplay(item.delivery_date, timezone)}\n`;
    }

    if (item.notes) {
      summary += `   ℹ️ ${item.notes}\n`;
    }

    summary += '\n';
  });

  summary += '━━━━━━━━━━━━━━━━━━\n';
  summary += `📦 Total Items: ${session.items.length}\n`;
  summary += `💰 *Grand Total: ₹${grandTotal}*\n`;

  // Add fulfillment info if available
  if (session.fulfillment_type) {
    summary += '\n';
    if (session.fulfillment_type === 'delivery' && session.delivery_address) {
      summary += `🚚 Delivery to: ${session.delivery_address}\n`;
      if (session.delivery_time) {
        // Format time using timezone-aware formatter
        summary += `⏰ Time: ${formatDeliveryTime(session.delivery_time, timezone)}\n`;
      }
    } else if (session.fulfillment_type === 'takeaway' && session.pickup_outlet_id) {
      summary += `📍 Pickup from outlet\n`;
      if (session.pickup_time) {
        // Format time using timezone-aware formatter
        summary += `⏰ Time: ${formatDeliveryTime(session.pickup_time, timezone)}\n`;
      }
    }
  }

  if (includeCta && ctaMessage) {
    summary += '\n' + ctaMessage;
  }

  return summary;
}

export async function createFinalOrder(sessionId: string): Promise<Order> {
  const session = await getSessionWithItems(sessionId);

  if (!session) {
    throw new Error('Session not found');
  }

  if (session.items.length === 0) {
    throw new Error('No items in session');
  }

  // Convert session items to order item data with prices
  let totalAmount = 0;
  const orderItems: OrderItemData[] = session.items.map((item) => {
    const lineTotal = (item.unit_price || 0) * item.quantity;
    totalAmount += lineTotal;

    // Process add-ons
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
      name: item.item_name,
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

  // Generate summary text
  const orderSummary = await generateOrderSummary(sessionId);

  // Find earliest delivery date from items
  const deliveryDates = session.items
    .map((item) => item.delivery_date)
    .filter((date): date is string => date !== null);

  const deliveryDate = deliveryDates.length > 0 ? deliveryDates[0] : null;

  // Generate user-friendly order number (e.g., "OKS-1")
  const businessId = session.business_id!;
  const orderNumber = await generateOrderNumber(businessId);

  // Create the order
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      business_id: businessId,
      session_id: sessionId,
      customer_id: session.customer_id,
      items: orderItems,
      total_items: session.items.length,
      total_amount: totalAmount,
      order_summary: orderSummary,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      delivery_date: deliveryDate,
      fulfillment_type: session.fulfillment_type || null,
      delivery_address: session.delivery_address || null,
      delivery_latitude: session.delivery_latitude || null,
      delivery_longitude: session.delivery_longitude || null,
      delivery_time: session.delivery_time || null,
      pickup_outlet_id: session.pickup_outlet_id || null,
      pickup_time: session.pickup_time || null,
      fulfillment_notes: session.fulfillment_notes || null,
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create order', error);
    throw new Error('Failed to create order');
  }

  // Mark session as completed
  await completeSession(sessionId);

  logger.info(`Order created: ${order.order_number} (ID: ${order.id}) - Total: ₹${totalAmount}`);

  // Send notification to business
  await sendOrderNotification(order as Order);

  return order as Order;
}

export async function sendOrderNotification(order: Order, timezone: string = 'Asia/Kolkata'): Promise<void> {
  const notificationMethod = process.env.BUSINESS_NOTIFICATION_METHOD || 'console';

  // Get outlet name if pickup
  let outletInfo = '';
  if (order.fulfillment_type === 'takeaway' && order.pickup_outlet_id) {
    const { data: outlet } = await supabase
      .from('business_outlets')
      .select('outlet_name')
      .eq('id', order.pickup_outlet_id)
      .single();

    if (outlet) {
      outletInfo = ` from ${outlet.outlet_name}`;
    }
  }

  const notificationText = `
🔔 NEW ORDER RECEIVED
━━━━━━━━━━━━━━━━━━━━
Order #: ${order.order_number}
Customer ID: ${order.customer_id.substring(0, 8)}
Status: ${order.status}

${order.fulfillment_type === 'delivery' ? '🚚 DELIVERY' : order.fulfillment_type === 'takeaway' ? '📍 TAKEAWAY' : ''}
${order.delivery_address ? `Address: ${order.delivery_address}` : ''}
${order.pickup_outlet_id ? `Pickup${outletInfo}` : ''}
${order.delivery_time ? `Time: ${formatDeliveryTime(order.delivery_time, timezone)}` : ''}
${order.pickup_time ? `Pickup Time: ${formatDeliveryTime(order.pickup_time, timezone)}` : ''}
${order.fulfillment_notes ? `Notes: ${order.fulfillment_notes}` : ''}

Items:
${order.items
  .map(
    (item, i) => {
      let itemText = `${i + 1}. ${item.name}${item.size_or_weight ? ` (${item.size_or_weight})` : ''} x${item.quantity} - ₹${item.line_total || 0}`;

      // Add add-ons if any
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon) => {
          itemText += `\n   + ${addon.addon_name}`;
          if (addon.quantity > 1) {
            itemText += ` x${addon.quantity}`;
          }
          if (addon.unit_price) {
            itemText += ` - ₹${addon.line_total || 0}`;
          } else {
            itemText += ' - FREE';
          }
        });
      }

      return itemText;
    }
  )
  .join('\n')}

━━━━━━━━━━━━━━━━━━━━
Total Items: ${order.total_items}
💰 TOTAL: ₹${order.total_amount}
━━━━━━━━━━━━━━━━━━━━
Created: ${formatDeliveryTime(order.created_at, timezone)}
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

// Cancel an order by order_number (must belong to same business)
export async function cancelOrderById(
  orderNumber: string,
  customerId: string,
  businessId: string
): Promise<{ success: boolean; message: string; order?: Order }> {
  // Search by order_number within the same business
  const { data: orders, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .eq('business_id', businessId)
    .ilike('order_number', orderNumber.toUpperCase());

  if (fetchError || !orders || orders.length === 0) {
    return {
      success: false,
      message: `Order #${orderNumber} not found. Please check the order number and try again.`,
    };
  }

  const order = orders[0] as Order;

  // Verify this order belongs to the customer
  if (order.customer_id !== customerId) {
    return {
      success: false,
      message: `Order #${orderNumber} not found. Please check the order number and try again.`,
    };
  }

  // Check if order can be cancelled (only confirmed orders)
  if (order.status === 'cancelled') {
    return {
      success: false,
      message: `Order #${order.order_number} is already cancelled.`,
    };
  }

  if (order.status === 'completed') {
    return {
      success: false,
      message: `Order #${order.order_number} is already completed and cannot be cancelled.`,
    };
  }

  // Cancel the order and verify the update
  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select()
    .single();

  if (updateError) {
    logger.error('Failed to cancel order', updateError);
    return {
      success: false,
      message: 'Failed to cancel order. Please try again or contact us.',
    };
  }

  // Verify the update was applied
  if (!updatedOrder || updatedOrder.status !== 'cancelled') {
    logger.error(`Order cancel update failed - status is still: ${updatedOrder?.status}`);
    return {
      success: false,
      message: 'Failed to cancel order. Please try again or contact us.',
    };
  }

  logger.info(`Order cancelled successfully: ${order.order_number} (DB status: ${updatedOrder.status})`);

  return {
    success: true,
    message: `Order #${order.order_number} has been cancelled successfully.`,
    order: { ...order, status: 'cancelled' },
  };
}

// Get order by order_number for a customer (within a business)
export async function getOrderByOrderNumber(
  orderNumber: string,
  customerId: string,
  businessId: string
): Promise<Order | null> {
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .ilike('order_number', orderNumber.toUpperCase());

  if (!orders || orders.length === 0) {
    return null;
  }

  return orders[0] as Order;
}

// Get order status with formatted response
export async function getOrderStatus(
  orderNumber: string,
  customerId: string,
  businessId: string,
  timezone: string = 'Asia/Kolkata'
): Promise<{ success: boolean; message: string; order?: Order }> {
  const order = await getOrderByOrderNumber(orderNumber, customerId, businessId);

  if (!order) {
    return {
      success: false,
      message: `Order #${orderNumber} not found. Please check the order number and try again.`,
    };
  }

  // Format status message
  const statusEmoji: Record<string, string> = {
    confirmed: '✅',
    processing: '🔄',
    completed: '🎉',
    cancelled: '❌',
  };

  const statusText: Record<string, string> = {
    confirmed: 'Order Confirmed - We are preparing your order',
    processing: 'Being Prepared - Your order is being prepared',
    completed: 'Completed - Your order has been delivered/picked up',
    cancelled: 'Cancelled - This order was cancelled',
  };

  let message = `📋 *Order Status: #${order.order_number}*\n\n`;
  message += `${statusEmoji[order.status] || '📦'} *${statusText[order.status] || order.status}*\n\n`;
  message += `💰 Total: ₹${order.total_amount}\n`;

  if (order.fulfillment_type === 'delivery' && order.delivery_address) {
    message += `🚚 Delivery to: ${order.delivery_address}\n`;
    if (order.delivery_time) {
      message += `⏰ Time: ${formatDeliveryTime(order.delivery_time, timezone)}\n`;
    }
  } else if (order.fulfillment_type === 'takeaway') {
    message += `🏪 Takeaway\n`;
    if (order.pickup_time) {
      message += `⏰ Time: ${formatDeliveryTime(order.pickup_time, timezone)}\n`;
    }
  }

  message += `\n📅 Ordered: ${formatDeliveryTime(order.created_at, timezone)}`;

  return {
    success: true,
    message,
    order,
  };
}
