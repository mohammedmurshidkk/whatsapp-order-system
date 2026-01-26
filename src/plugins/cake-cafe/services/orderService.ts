import { supabase } from '@/config/database';
import { DEFAULT_LANGUAGE, SupportedLanguage, t } from '../../../i18n';
import { SessionItem, Order, AIItemResponse, OrderItemData, MenuItem, MenuCategory, Business } from '@/types';
import {
  getSessionWithItems,
  findOrCreateSession,
  updateSessionActivity,
  updateSessionItemCount,
  getSessionLanguage,
} from '../../../services/sessionService';
import { searchMenuItem, getBusinessById } from './menuService';
import { formatDeliveryTime, formatDateForDisplay, calculateDistanceBasedDeliveryFee } from './fulfillmentService';
import { logger } from '@/utils/logger';
import { parseWeight, isWeightString } from '@/utils/weightUtils';
import { updateItemStats } from './popularItemsService';

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
  const dateStr = today.slice(2).replace(/-/g, ''); // "2025-12-16" → "251216"
  const orderNumber = `${prefix}-${dateStr}-${nextNumber}`;

  logger.info(`Generated order number: ${orderNumber} for business ${businessId}`);
  return orderNumber;
}

// Helper to get price for an item based on size (supports custom weight pricing)
function getItemPrice(
  menuItem: MenuItem,
  sizeOrWeight?: string | null,
  category?: MenuCategory | null
): number | null {
  // If item has sizes, try to find matching size price first
  if (menuItem.sizes && menuItem.sizes.length > 0) {
    if (sizeOrWeight) {
      const normalizedSize = sizeOrWeight.toLowerCase().trim();

      // First check for exact size match (e.g., "500g", "1kg")
      const exactMatch = menuItem.sizes.find(
        s => s.name.toLowerCase() === normalizedSize
      );
      if (exactMatch) {
        return exactMatch.price;
      }

      // Fuzzy match for slight variations
      const fuzzyMatch = menuItem.sizes.find(
        s => s.name.toLowerCase().includes(normalizedSize) ||
          normalizedSize.includes(s.name.toLowerCase())
      );
      if (fuzzyMatch) {
        return fuzzyMatch.price;
      }

      // If no exact match and custom weight is enabled, calculate custom weight price
      if (category?.allows_custom_weight && isWeightString(sizeOrWeight)) {
        const parsed = parseWeight(sizeOrWeight);
        if (parsed.isValid) {
          // Find the base size price (e.g., 1kg price)
          const baseSize = category.custom_weight_base_size || '1kg';
          const baseSizeItem = menuItem.sizes.find(
            s => s.name.toLowerCase() === baseSize.toLowerCase()
          );

          if (baseSizeItem) {
            // Calculate: base_price_per_gram × requested_grams
            const baseParsed = parseWeight(baseSize);
            if (baseParsed.isValid && baseParsed.grams > 0) {
              const pricePerGram = baseSizeItem.price / baseParsed.grams;
              const calculatedPrice = Math.round(pricePerGram * parsed.grams);
              logger.info(`Custom weight price: ${sizeOrWeight} = ₹${calculatedPrice} (based on ${baseSize} @ ₹${baseSizeItem.price})`);
              return calculatedPrice;
            }
          }
        }
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
    // Fetch category for custom weight pricing
    let category: MenuCategory | null = null;
    if (menuItem.category_id) {
      const { data: categoryData } = await supabase
        .from('menu_categories')
        .select('*')
        .eq('id', menuItem.category_id)
        .single();
      category = categoryData as MenuCategory | null;
    }
    unitPrice = getItemPrice(menuItem, item.size_or_weight, category);
    logger.info(`Price lookup: ${item.name} (${item.size_or_weight || 'default'}) = ₹${unitPrice} `);
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

  logger.info(`Order item saved: ${item.name} @ ₹${unitPrice || 'N/A'} `);
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

  logger.info(`Updated ${itemName} quantity to ${newQuantity} `);
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

// Generate order summary - automatically includes delivery fee when applicable
export async function generateOrderSummary(
  sessionId: string,
  options: { includeCta?: boolean; ctaMessage?: string; timezone?: string; includeDeliveryFee?: boolean } = {}
): Promise<string> {
  const { includeCta = false, ctaMessage = 'Reply *YES* to confirm your order' } = options;
  // Handle undefined timezone explicitly (destructuring default doesn't work for explicit undefined)
  const timezone = options.timezone || 'Asia/Kolkata';

  const session = await getSessionWithItems(sessionId);

  // If session is null or empty, return early with default language for the error message
  if (!session || session.items.length === 0) {
    // We cannot determine the user's preferred language if there's no session
    // Fallback to default language for this error message
    return t('order.noItems', DEFAULT_LANGUAGE);
  }

  // Get language from the session, now that we know session is not null
  const lang: SupportedLanguage = getSessionLanguage(session);


  let summary = `${t('orderSummary.title', lang)} \n`;
  summary += '━━━━━━━━━━━━━━━━━━\n\n';

  let grandTotal = 0;

  session.items.forEach((item, index) => {
    const lineTotal = (item.unit_price || 0) * item.quantity;
    grandTotal += lineTotal;

    summary += `${index + 1}. ${item.item_name} `;

    if (item.size_or_weight) {
      summary += ` (${item.size_or_weight})`;
    }

    if (item.quantity > 1) {
      summary += ` x${item.quantity} `;
    }

    // Show price
    if (item.unit_price) {
      if (item.quantity > 1) {
        summary += `\n   ₹${item.unit_price} × ${item.quantity} = ₹${lineTotal} `;
      } else {
        summary += ` - ₹${item.unit_price} `;
      }
    }

    summary += '\n';

    // Show add-ons
    if (item.addons && item.addons.length > 0) {
      item.addons.forEach((addon) => {
        const addonTotal = (addon.unit_price || 0) * addon.quantity;
        grandTotal += addonTotal;

        summary += `   + ${addon.addon_name} `;

        if (addon.quantity > 1) {
          summary += ` x${addon.quantity} `;
        }

        if (addon.unit_price !== null && addon.unit_price > 0) {
          if (addon.quantity > 1) {
            summary += ` - ₹${addon.unit_price} × ${addon.quantity} = ₹${addonTotal} `;
          } else {
            summary += ` - ₹${addon.unit_price} `;
          }
        } else {
          summary += t('order.addonFree', lang);
        }

        summary += '\n';
      });
    }

    if (item.custom_text) {
      summary += `   📝 "${item.custom_text}"\n`;
    }

    if (item.delivery_date) {
      // Format delivery date using timezone
      summary += `   📅 ${formatDateForDisplay(item.delivery_date, timezone)} \n`;
    }

    if (item.notes) {
      summary += `   ℹ️ ${item.notes} \n`;
    }

    summary += '\n';
  });

  summary += '━━━━━━━━━━━━━━━━━━\n';
  summary += `${t('orderSummary.totalItems', lang, { count: session.items.length || 0 })} \n`;
  summary += `${t('orderSummary.subtotal', lang, { amount: grandTotal })} \n`;

  // Automatically calculate and display delivery fee for delivery orders with coordinates
  let deliveryFee = 0;
  let showDeliveryFee = false;

  if (
    session.fulfillment_type === 'delivery' &&
    session.delivery_latitude &&
    session.delivery_longitude &&
    session.business_id
  ) {
    showDeliveryFee = true;

    // Check if admin set a custom delivery fee (for out-of-radius deliveries)
    if ((session as any).custom_delivery_fee !== null && (session as any).custom_delivery_fee !== undefined) {
      deliveryFee = (session as any).custom_delivery_fee;
      logger.info(`Using custom delivery fee: ₹${deliveryFee} (admin - approved out - of - radius)`);
    } else {
      const feeResult = await calculateDistanceBasedDeliveryFee(
        session.business_id,
        grandTotal,
        session.delivery_latitude,
        session.delivery_longitude
      );
      // Only show fee if not beyond max radius (beyond radius is handled separately)
      if (!feeResult.is_beyond_max_radius) {
        deliveryFee = feeResult.fee;
      }
    }
  }

  if (showDeliveryFee) {
    if (deliveryFee > 0) {
      summary += `${t('orderSummary.deliveryFee', lang, { amount: deliveryFee })} \n`;
    } else {
      summary += `${t('orderSummary.deliveryFeeFree', lang)} \n`;
    }
  }

  summary += `${t('orderSummary.grandTotal', lang, { amount: grandTotal + deliveryFee })} \n`;

  // Add fulfillment info if available
  if (session.fulfillment_type) {
    summary += '\n';
    if (session.fulfillment_type === 'delivery' && (session.delivery_address || session.delivery_geocoded_address || session.delivery_latitude)) {
      // Priority: 1. Manual address, 2. Geocoded address, 3. Google Maps link (never show raw lat/long)
      if (session.delivery_address) {
        summary += `${t('orderSummary.deliveryTo', lang, { address: session.delivery_address })} \n`;
      } else if (session.delivery_geocoded_address) {
        summary += `${t('orderSummary.deliveryTo', lang, { address: session.delivery_geocoded_address })} \n`;
      } else if (session.delivery_latitude && session.delivery_longitude) {
        // Show Google Maps link instead of raw coordinates
        const mapsLink = `https://maps.google.com/?q=${session.delivery_latitude},${session.delivery_longitude}`;
        summary += `${t('orderSummary.deliveryLocationLink', lang, { link: mapsLink })} \n`;
      }
      if (session.delivery_time) {
        // Format time using timezone-aware formatter
        summary += `${t('orderSummary.time', lang, { time: formatDeliveryTime(session.delivery_time, timezone, t('time.at', lang)) })} \n`;
      }
    } else if (session.fulfillment_type === 'takeaway' && session.pickup_outlet_id) {
      summary += `${t('orderSummary.pickupFrom', lang)} \n`;
      if (session.pickup_time) {
        // Format time using timezone-aware formatter
        summary += `${t('orderSummary.time', lang, { time: formatDeliveryTime(session.pickup_time, timezone, t('time.at', lang)) })} \n`;
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
    throw new Error('Failed to create order');
  }

  if (session.items.length === 0) {
    throw new Error('Failed to create order');
  }

  // Fetch menu items with category custom_text_prompt for this business
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('name, category_id, menu_categories(custom_text_prompt)')
    .eq('business_id', session.business_id);

  // Create a map of item name -> custom_text_prompt
  const promptMap = new Map<string, string | null>();
  if (menuItems) {
    for (const mi of menuItems) {
      const prompt = (mi.menu_categories as any)?.custom_text_prompt || null;
      promptMap.set(mi.name.toLowerCase(), prompt);
    }
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

    // Get custom_text_prompt for this item
    const customTextPrompt = promptMap.get(item.item_name.toLowerCase()) || undefined;

    return {
      name: item.item_name,
      quantity: item.quantity,
      size_or_weight: item.size_or_weight || undefined,
      unit_price: item.unit_price || undefined,
      line_total: lineTotal || undefined,
      custom_text: item.custom_text || undefined,
      custom_text_prompt: customTextPrompt,
      delivery_date: item.delivery_date || undefined,
      notes: item.notes || undefined,
      addons: addons.length > 0 ? addons : undefined,
    };
  });

  // Calculate delivery fee if delivery order with coordinates
  let deliveryFee = 0;
  logger.info(`[DELIVERY - FEE] Checking: fulfillment = ${session.fulfillment_type}, lat = ${session.delivery_latitude}, lng = ${session.delivery_longitude} `);

  if (
    session.fulfillment_type === 'delivery' &&
    session.delivery_latitude &&
    session.delivery_longitude &&
    session.business_id
  ) {
    // Check if admin set a custom delivery fee (for out-of-radius deliveries)
    if ((session as any).custom_delivery_fee !== null && (session as any).custom_delivery_fee !== undefined) {
      deliveryFee = (session as any).custom_delivery_fee;
      logger.info(`[DELIVERY - FEE] Using custom fee: ₹${deliveryFee} (admin - approved out - of - radius)`);
    } else {
      const feeResult = await calculateDistanceBasedDeliveryFee(
        session.business_id,
        totalAmount,
        session.delivery_latitude,
        session.delivery_longitude
      );
      deliveryFee = feeResult.fee;
      logger.info(`[DELIVERY - FEE] Calculated: ₹${deliveryFee} (distance: ${(feeResult.distance_meters / 1000).toFixed(2)}km, beyond_max: ${feeResult.is_beyond_max_radius})`);
    }
  } else {
    logger.info(`[DELIVERY - FEE] Skipped: Missing required fields for delivery fee calculation`);
  }

  // Grand total includes delivery fee
  const grandTotal = totalAmount + deliveryFee;

  // Generate summary text (includes delivery fee)
  const orderSummary = await generateOrderSummary(sessionId, { includeDeliveryFee: true });

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
      total_amount: grandTotal,
      delivery_fee: deliveryFee,
      order_summary: orderSummary,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      delivery_date: deliveryDate,
      fulfillment_type: session.fulfillment_type || null,
      delivery_address: session.delivery_address || null,
      delivery_geocoded_address: session.delivery_geocoded_address || null,
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

  // Track item stats for popularity
  if (order && order.items) {
    // The items in order.items are of type OrderItemData, which lacks menu_item_id
    // We need to fetch it to call updateItemStats.
    const itemsForStats = await Promise.all(
      (order.items as OrderItemData[]).map(async (item) => {
        const menuItem = await searchMenuItem(order.business_id, item.name);
        return {
          ...item,
          menu_item_id: menuItem?.id,
          price: item.unit_price || 0,
        };
      })
    );
    await updateItemStats(order.business_id, itemsForStats);
  }

  // Note: Session stays active until admin marks order as completed/cancelled
  // This allows customers to continue asking about their order

  // Clear session items (order data is now in orders.items JSONB)
  // This prevents showing old cart items when customer messages again
  const { error: clearError } = await supabase
    .from('session_items')
    .delete()
    .eq('session_id', sessionId);

  if (clearError) {
    logger.warn(`Failed to clear session items for session ${sessionId}: `, clearError);
    // Don't fail the order - items are already stored in the order
  }

  // Clear session fulfillment data to prevent stale data in next order
  // Order details are preserved in the orders table for follow-up queries
  const { error: clearFulfillmentError } = await supabase
    .from('sessions')
    .update({
      fulfillment_type: null,
      delivery_address: null,
      delivery_time: null,
      delivery_latitude: null,
      delivery_longitude: null,
      delivery_geocoded_address: null,
      pickup_outlet_id: null,
      pickup_time: null,
      fulfillment_notes: null,
      custom_delivery_fee: null,
    })
    .eq('id', sessionId);

  if (clearFulfillmentError) {
    logger.warn(`Failed to clear session fulfillment data for session ${sessionId}: `, clearFulfillmentError);
  } else {
    logger.info(`Cleared session fulfillment data for session ${sessionId}`);
  }

  logger.info(`Order created: ${order.order_number} (ID: ${order.id}) - Total: ₹${grandTotal} (items: ₹${totalAmount}, delivery: ₹${deliveryFee})`);

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
      outletInfo = ` from ${outlet.outlet_name} `;
    }
  }

  const notificationText = `
🔔 NEW ORDER RECEIVED
━━━━━━━━━━━━━━━━━━━━
Order #: ${order.order_number}
Customer ID: ${order.customer_id.substring(0, 8)}
Status: ${order.status}

${order.fulfillment_type === 'delivery' ? '🚚 DELIVERY' : order.fulfillment_type === 'takeaway' ? '📍 TAKEAWAY' : ''}
${order.delivery_address ? `Address: ${order.delivery_address}` : (order.delivery_geocoded_address ? `Address: ${order.delivery_geocoded_address}` : (order.delivery_latitude && order.delivery_longitude ? `Location: https://maps.google.com/?q=${order.delivery_latitude},${order.delivery_longitude}` : ''))}
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
      .join('\n')
    }

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

/**
 * Get customer's most recent active order (for "where's my order?" without order number)
 * Active statuses: confirmed, processing, out_for_delivery (not completed/cancelled)
 */
export async function getCustomerActiveOrder(customerId: string, businessId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .in('status', ['confirmed', 'processing', 'out_for_delivery'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // No active order found is not an error
    if (error.code === 'PGRST116') {
      return null;
    }
    logger.error('Failed to fetch active order', error);
    return null;
  }

  return data as Order;
}

/**
 * Get formatted status message for an active order
 * Used when customer asks "where's my order?" without specifying order number
 */
export function getOrderStatusMessage(order: Order, lang: SupportedLanguage, timezone: string = 'Asia/Kolkata'): string {
  const statusEmojis: Record<string, string> = {
    confirmed: '✅',
    processing: '👨‍🍳',
    completed: '🎉',
    cancelled: '❌',
  };

  const statusMessages: Record<string, string> = {
    confirmed: t('order.status.confirmed', lang),
    processing: t('order.status.processing', lang),
    completed: t('order.status.completed', lang),
    cancelled: t('order.status.cancelled', lang),
  };

  let message = `${t('order.statusTitle', lang, { orderNumber: order.order_number })} \n\n`;
  message += `${statusEmojis[order.status] || '📦'} ${statusMessages[order.status] || t('order.status.inProgress', lang)} \n\n`;
  message += `${t('order.total', lang, { amount: order.total_amount })} \n`;

  if (order.fulfillment_type === 'delivery' && order.delivery_address) {
    message += `${t('orderSummary.deliveryTo', lang, { address: order.delivery_address })} \n`;
    if (order.delivery_time) {
      message += `${t('order.time', lang, { time: formatDeliveryTime(order.delivery_time, timezone, t('time.at', lang)) })} \n`;
    }
  } else if (order.fulfillment_type === 'takeaway') {
    message += `${t('order.takeaway', lang)} \n`;
    if (order.pickup_time) {
      message += `${t('order.time', lang, { time: formatDeliveryTime(order.pickup_time, timezone, t('time.at', lang)) })} \n`;
    }
  }

  message += t('order.needHelp', lang);

  return message;
}

// Cancel an order by order_number (must belong to same business)
export async function cancelOrderById(
  orderNumber: string,
  customerId: string,
  businessId: string
): Promise<{ success: boolean; message: string; order?: Order }> {
  // Get language from customer and business ID
  // Note: findOrCreateSession won't create a new session if one already exists for the customer/business
  const customerSession = await findOrCreateSession(customerId, businessId);
  const lang: SupportedLanguage = getSessionLanguage(customerSession.session);

  // Search by order_number within the same business
  const { data: orders, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .eq('business_id', businessId)
    .ilike('order_number', orderNumber.toUpperCase());

  if (fetchError || !orders || orders.length === 0) {
    return {
      success: false,
      message: t('order.cancel.notFound', lang, { orderNumber }),
    };
  }

  const order = orders[0] as Order;

  // Verify this order belongs to the customer
  if (order.customer_id !== customerId) {
    return {
      success: false,
      message: t('order.cancel.notFound', lang, { orderNumber }),
    };
  }

  // Check if order can be cancelled (only confirmed orders)
  if (order.status === 'cancelled') {
    return {
      success: false,
      message: t('order.cancel.alreadyCancelled', lang, { orderNumber: order.order_number }),
    };
  }

  if (order.status === 'completed') {
    return {
      success: false,
      message: t('order.cancel.alreadyCompleted', lang, { orderNumber: order.order_number }),
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
      message: t('order.cancel.failed', lang),
    };
  }

  // Verify the update was applied
  if (!updatedOrder || updatedOrder.status !== 'cancelled') {
    logger.error(`Order cancel update failed - status is still: ${updatedOrder?.status} `);
    return {
      success: false,
      message: t('order.cancel.failed', lang),
    };
  }

  logger.info(`Order cancelled successfully: ${order.order_number} (DB status: ${updatedOrder.status})`);

  return {
    success: true,
    message: t('order.cancel.success', lang, { orderNumber: order.order_number }),
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
  // Get language from customer and business ID
  const customerSession = await findOrCreateSession(customerId, businessId);
  const lang: SupportedLanguage = getSessionLanguage(customerSession.session);

  const order = await getOrderByOrderNumber(orderNumber, customerId, businessId);

  if (!order) {
    return {
      success: false,
      message: t('order.cancel.notFound', lang, { orderNumber }),
    };
  }

  // Format status message
  const statusEmoji: Record<string, string> = {
    confirmed: '✅',
    processing: '🔄',
    out_for_delivery: '🚚',
    completed: '🎉',
    cancelled: '❌',
  };

  const statusText: Record<string, string> = {
    confirmed: t('order.statusText.confirmed', lang),
    processing: t('order.statusText.processing', lang),
    out_for_delivery: t('order.statusText.out_for_delivery', lang),
    completed: t('order.statusText.completed', lang),
    cancelled: t('order.statusText.cancelled', lang),
  };

  let message = `${t('order.statusDetailTitle', lang, { orderNumber: order.order_number })} \n\n`;
  message += `${statusEmoji[order.status] || '📦'} * ${statusText[order.status] || order.status}*\n\n`;
  message += `${t('order.total', lang, { amount: order.total_amount })} \n`;

  if (order.fulfillment_type === 'delivery' && order.delivery_address) {
    message += `${t('orderSummary.deliveryTo', lang, { address: order.delivery_address })} \n`;
    if (order.delivery_time) {
      message += `${t('order.time', lang, { time: formatDeliveryTime(order.delivery_time, timezone, t('time.at', lang)) })} \n`;
    }
  } else if (order.fulfillment_type === 'takeaway') {
    message += `${t('order.takeaway', lang)} \n`;
    if (order.pickup_time) {
      message += `${t('order.time', lang, { time: formatDeliveryTime(order.pickup_time, timezone, t('time.at', lang)) })} \n`;
    }
  }

  message += t('order.orderedDate', lang, { date: formatDeliveryTime(order.created_at, timezone, t('time.at', lang)) });

  return {
    success: true,
    message,
    order,
  };
}
