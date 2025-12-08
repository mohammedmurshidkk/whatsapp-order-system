import { supabase } from '../config/database';
import { FulfillmentType } from '../types';
import { logger } from '../utils/logger';

/**
 * Update session with fulfillment type
 */
export async function updateSessionFulfillmentType(
  sessionId: string,
  fulfillmentType: FulfillmentType
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ fulfillment_type: fulfillmentType })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update session fulfillment type', error);
    throw new Error('Failed to update fulfillment type');
  }

  logger.info(`Session ${sessionId} fulfillment type set to: ${fulfillmentType}`);
}

/**
 * Update session with delivery information
 */
export async function updateSessionDeliveryInfo(
  sessionId: string,
  deliveryInfo: {
    address: string;
    time?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({
      delivery_address: deliveryInfo.address,
      delivery_time: deliveryInfo.time || null,
      delivery_latitude: deliveryInfo.latitude || null,
      delivery_longitude: deliveryInfo.longitude || null,
      fulfillment_notes: deliveryInfo.notes || null,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update delivery info', error);
    throw new Error('Failed to update delivery information');
  }

  logger.info(`Delivery info updated for session ${sessionId}`);
}

/**
 * Update session with pickup (takeaway) information
 */
export async function updateSessionPickupInfo(
  sessionId: string,
  pickupInfo: {
    outlet_id: string;
    time?: string;
    notes?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({
      pickup_outlet_id: pickupInfo.outlet_id,
      pickup_time: pickupInfo.time || null,
      fulfillment_notes: pickupInfo.notes || null,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update pickup info', error);
    throw new Error('Failed to update pickup information');
  }

  logger.info(`Pickup info updated for session ${sessionId}`);
}

/**
 * Parse delivery time from natural language
 * Examples: "tomorrow 5pm", "today evening", "2pm", "in 2 hours"
 */
export function parseDeliveryTime(timeText: string): string | null {
  const normalizedTime = timeText.toLowerCase().trim();
  const now = new Date();

  // Handle "tomorrow"
  if (normalizedTime.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Extract time if mentioned
    const timeMatch = normalizedTime.match(/(\d{1,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      if (timeMatch[2].toLowerCase() === 'pm' && hours !== 12) {
        hours += 12;
      }
      tomorrow.setHours(hours, 0, 0, 0);
    } else {
      tomorrow.setHours(14, 0, 0, 0); // Default 2pm
    }

    return tomorrow.toISOString();
  }

  // Handle "today"
  if (normalizedTime.includes('today')) {
    const today = new Date(now);

    const timeMatch = normalizedTime.match(/(\d{1,2})\s*(am|pm)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      if (timeMatch[2].toLowerCase() === 'pm' && hours !== 12) {
        hours += 12;
      }
      today.setHours(hours, 0, 0, 0);
    } else {
      today.setHours(now.getHours() + 2, 0, 0, 0); // 2 hours from now
    }

    return today.toISOString();
  }

  // Handle specific time (5pm, 2:30pm, etc.)
  const timeMatch = normalizedTime.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    const resultTime = new Date(now);
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

    if (timeMatch[3].toLowerCase() === 'pm' && hours !== 12) {
      hours += 12;
    } else if (timeMatch[3].toLowerCase() === 'am' && hours === 12) {
      hours = 0;
    }

    resultTime.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, assume tomorrow
    if (resultTime < now) {
      resultTime.setDate(resultTime.getDate() + 1);
    }

    return resultTime.toISOString();
  }

  // Handle "evening", "morning", "afternoon"
  if (normalizedTime.includes('evening')) {
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    if (evening < now) {
      evening.setDate(evening.getDate() + 1);
    }
    return evening.toISOString();
  }

  if (normalizedTime.includes('morning')) {
    const morning = new Date(now);
    morning.setDate(morning.getDate() + 1);
    morning.setHours(10, 0, 0, 0);
    return morning.toISOString();
  }

  if (normalizedTime.includes('afternoon')) {
    const afternoon = new Date(now);
    afternoon.setHours(15, 0, 0, 0);
    if (afternoon < now) {
      afternoon.setDate(afternoon.getDate() + 1);
    }
    return afternoon.toISOString();
  }

  // Default: return null if can't parse
  return null;
}

/**
 * Format delivery time for display
 */
export function formatDeliveryTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === new Date(now.setDate(now.getDate() + 1)).toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) {
    return `Today at ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow at ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return `${dateStr} at ${timeStr}`;
  }
}

/**
 * Calculate delivery fee based on business rules
 */
export async function calculateDeliveryFee(
  businessId: string,
  orderAmount: number
): Promise<number> {
  const { data: business } = await supabase
    .from('businesses')
    .select('delivery_fee, free_delivery_above')
    .eq('id', businessId)
    .single();

  if (!business) {
    return 0;
  }

  // Free delivery if order is above threshold
  if (business.free_delivery_above && orderAmount >= business.free_delivery_above) {
    return 0;
  }

  return business.delivery_fee || 0;
}
