import { supabase } from '../config/database';
import { FulfillmentType } from '../types';
import { logger } from '../utils/logger';

/**
 * Update session with fulfillment type
 * IMPORTANT: When switching fulfillment type, clears the opposite type's data
 * This prevents confusion when customer switches from takeaway to delivery or vice versa
 */
export async function updateSessionFulfillmentType(
  sessionId: string,
  fulfillmentType: FulfillmentType
): Promise<void> {
  // Build update object based on fulfillment type
  // Clear opposite type's data to prevent conflicts
  const updateData: Record<string, unknown> = {
    fulfillment_type: fulfillmentType,
  };

  if (fulfillmentType === 'delivery') {
    // Switching to delivery - clear takeaway info
    updateData.pickup_outlet_id = null;
    updateData.pickup_time = null;
    logger.info(`Clearing takeaway data for session ${sessionId} (switching to delivery)`);
  } else if (fulfillmentType === 'takeaway') {
    // Switching to takeaway - clear delivery info
    updateData.delivery_address = null;
    updateData.delivery_time = null;
    updateData.delivery_latitude = null;
    updateData.delivery_longitude = null;
    logger.info(`Clearing delivery data for session ${sessionId} (switching to takeaway)`);
  }

  const { error } = await supabase
    .from('sessions')
    .update(updateData)
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
 * Get current time in a specific timezone
 */
function getNowInTimezone(timezone: string): Date {
  // Get current UTC time
  const now = new Date();
  // Format it in the target timezone and parse back
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const dateObj: Record<string, string> = {};
  parts.forEach(part => {
    dateObj[part.type] = part.value;
  });

  // Create a date string that represents local time in that timezone
  return new Date(`${dateObj.year}-${dateObj.month}-${dateObj.day}T${dateObj.hour}:${dateObj.minute}:${dateObj.second}`);
}

/**
 * Convert a local datetime in a timezone to UTC ISO string
 * @param localDate - Date object with local time values
 * @param timezone - IANA timezone (e.g., 'Asia/Kolkata')
 */
function localToUTC(year: number, month: number, day: number, hours: number, minutes: number, timezone: string): string | null {
  try {
    // Validate inputs to prevent Invalid Date errors
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) {
      logger.error(`localToUTC received invalid parameters: year=${year}, month=${month}, day=${day}, hours=${hours}, minutes=${minutes}`);
      return null;
    }

    // Ensure timezone has a valid value
    const tz = timezone || 'Asia/Kolkata';

    // Create a date string in the format expected by the timezone
    const localDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    // Get timezone offset for that specific date/time
    // We use Intl to find what offset that timezone has at that local time
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });

    // Create a test date (assume UTC first, then adjust)
    const testDate = new Date(localDateStr + 'Z');

    // Validate test date
    if (isNaN(testDate.getTime())) {
      logger.error(`localToUTC created invalid testDate from: ${localDateStr}Z`);
      return null;
    }

    // Get the offset string (e.g., "GMT+05:30")
    const parts = formatter.formatToParts(testDate);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    const offsetStr = tzPart?.value || '+00:00';

    // Parse offset (e.g., "GMT+5:30" -> +5.5 hours)
    const offsetMatch = offsetStr.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      const offsetHours = parseInt(offsetMatch[2], 10);
      const offsetMinutes = parseInt(offsetMatch[3] || '0', 10);
      const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);

      // Create the local date and subtract the offset to get UTC
      const localMs = new Date(localDateStr).getTime();
      const utcMs = localMs - (totalOffsetMinutes * 60 * 1000);
      return new Date(utcMs).toISOString();
    }

    // Fallback: return as-is (assume server timezone matches)
    return new Date(localDateStr).toISOString();
  } catch (error) {
    logger.error(`localToUTC error: ${error}`);
    return null;
  }
}

/**
 * Parse delivery time from natural language
 * Supports: English, Malayalam (nale, innu, innale)
 * Examples: "tomorrow 5pm", "today evening", "2pm", "in 2 hours", "nale 5pm", "innu evening"
 *
 * IMPORTANT: User input is interpreted as being in the business timezone.
 * The returned ISO string is in UTC for database storage.
 *
 * @param timeText - Natural language time input from user
 * @param timezone - Business timezone (IANA format, e.g., 'Asia/Kolkata')
 */
export function parseDeliveryTime(timeText: string, timezone: string = 'Asia/Kolkata'): string | null {
  // Ensure timezone has a valid value even if null/undefined is explicitly passed
  const tz = timezone || 'Asia/Kolkata';
  const normalizedTime = timeText.toLowerCase().trim();

  // Get current time in business timezone
  const nowInTz = getNowInTimezone(tz);

  // Validate that we got a valid date
  if (isNaN(nowInTz.getTime())) {
    logger.error(`Invalid date from getNowInTimezone with timezone: ${tz}`);
    return null;
  }

  const todayYear = nowInTz.getFullYear();
  const todayMonth = nowInTz.getMonth();
  const todayDay = nowInTz.getDate();
  const currentHour = nowInTz.getHours();

  // Malayalam word mappings (including common typos)
  const todayWords = ['today', 'innu', 'ഇന്ന്', 'இன்று'];
  const tomorrowWords = ['tomorrow', 'tomorow', 'tommorow', 'tmrw', 'tmr', 'nale', 'നാളെ', 'நாளை', 'kal'];

  // Helper to extract hours and minutes from time text
  function extractTime(text: string): { hours: number; minutes: number } | null {
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

    // Handle AM/PM
    if (timeMatch[3]?.toLowerCase() === 'pm' && hours !== 12) {
      hours += 12;
    } else if (timeMatch[3]?.toLowerCase() === 'am' && hours === 12) {
      hours = 0;
    } else if (!timeMatch[3] && hours >= 1 && hours <= 6) {
      // If no am/pm specified and time is 1-6, assume PM for business hours
      hours += 12;
    }

    return { hours, minutes };
  }

  // Check for tomorrow (including Malayalam "nale")
  const isTomorrow = tomorrowWords.some(word => normalizedTime.includes(word));
  if (isTomorrow) {
    const tomorrowDate = new Date(todayYear, todayMonth, todayDay + 1);
    const time = extractTime(normalizedTime);
    const hours = time?.hours ?? 12;  // Default noon
    const minutes = time?.minutes ?? 0;

    return localToUTC(tomorrowDate.getFullYear(), tomorrowDate.getMonth(), tomorrowDate.getDate(), hours, minutes, tz);
  }

  // Check for today (including Malayalam "innu")
  const isToday = todayWords.some(word => normalizedTime.includes(word));
  if (isToday) {
    const time = extractTime(normalizedTime);
    let hours = time?.hours ?? (currentHour + 2);
    const minutes = time?.minutes ?? 0;

    // If time has passed today, return null
    if (hours < currentHour || (hours === currentHour && minutes <= nowInTz.getMinutes())) {
      return null;
    }

    return localToUTC(todayYear, todayMonth, todayDay, hours, minutes, tz);
  }

  // Handle 24-hour time format (like "20:00")
  const time24Match = normalizedTime.match(/(\d{1,2}):(\d{2})\s*(pm|am)?/i);
  if (time24Match) {
    let hours = parseInt(time24Match[1], 10);
    const minutes = parseInt(time24Match[2], 10);

    if (time24Match[3]?.toLowerCase() === 'pm' && hours !== 12) {
      hours += 12;
    } else if (time24Match[3]?.toLowerCase() === 'am' && hours === 12) {
      hours = 0;
    }

    // Check if time has passed today
    const isPast = hours < currentHour || (hours === currentHour && minutes <= nowInTz.getMinutes());
    const targetDate = isPast ? new Date(todayYear, todayMonth, todayDay + 1) : new Date(todayYear, todayMonth, todayDay);

    return localToUTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), hours, minutes, tz);
  }

  // Handle specific time (5pm, 2:30pm, etc.)
  const time = extractTime(normalizedTime);
  if (time) {
    const isPast = time.hours < currentHour || (time.hours === currentHour && time.minutes <= nowInTz.getMinutes());
    const targetDate = isPast ? new Date(todayYear, todayMonth, todayDay + 1) : new Date(todayYear, todayMonth, todayDay);

    return localToUTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), time.hours, time.minutes, tz);
  }

  // Handle "evening", "morning", "afternoon" (English and Malayalam)
  const eveningWords = ['evening', 'vaikunneram', 'വൈകുന്നേരം', 'സന്ധ്യ'];
  const morningWords = ['morning', 'ravile', 'രാവിലെ', 'காலை'];
  const afternoonWords = ['afternoon', 'uchakku', 'ഉച്ചയ്ക്ക്'];

  if (eveningWords.some(w => normalizedTime.includes(w))) {
    const isPast = currentHour >= 18;
    const targetDate = isPast ? new Date(todayYear, todayMonth, todayDay + 1) : new Date(todayYear, todayMonth, todayDay);
    return localToUTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 18, 0, tz);
  }

  if (morningWords.some(w => normalizedTime.includes(w))) {
    // Morning is always tomorrow (can't order for same day morning if it's already past)
    const targetDate = new Date(todayYear, todayMonth, todayDay + 1);
    return localToUTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 10, 0, tz);
  }

  if (afternoonWords.some(w => normalizedTime.includes(w))) {
    const isPast = currentHour >= 14;
    const targetDate = isPast ? new Date(todayYear, todayMonth, todayDay + 1) : new Date(todayYear, todayMonth, todayDay);
    return localToUTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 14, 0, tz);
  }

  // Handle "in X hours"
  const inHoursMatch = normalizedTime.match(/in\s+(\d+)\s*(?:hour|hr)s?/i);
  if (inHoursMatch) {
    const hoursToAdd = parseInt(inHoursMatch[1], 10);
    const resultTime = new Date(nowInTz);
    resultTime.setHours(resultTime.getHours() + hoursToAdd);
    return localToUTC(resultTime.getFullYear(), resultTime.getMonth(), resultTime.getDate(), resultTime.getHours(), resultTime.getMinutes(), tz);
  }

  // Default: return null if can't parse
  return null;
}

/**
 * Extract date/time from a message that might contain address + time
 * Example: "MG Road, tomorrow 5pm" -> { address: "MG Road", time: "2024-12-10T17:00:00Z" }
 * @param message - User's message
 * @param timezone - Business timezone for parsing time
 */
export function extractAddressAndTime(message: string, timezone: string = 'Asia/Kolkata'): { address: string; time: string | null } {
  const normalizedMsg = message.toLowerCase();

  // Time patterns to look for
  const timePatterns = [
    /\b(today|tomorrow|nale|innu|kal)\b.*$/i,
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b.*$/i,
    /\b(\d{1,2}:\d{2})\s*(?:pm|am)?\b.*$/i,
    /\b(morning|evening|afternoon|ravile|vaikunneram)\b.*$/i,
    /\b(in\s+\d+\s*(?:hour|hr)s?)\b.*$/i,
  ];

  let timeText = '';
  let address = message;

  // Find time portion in message
  for (const pattern of timePatterns) {
    const match = message.match(pattern);
    if (match) {
      timeText = match[0];
      // Remove time from address (and any trailing comma/space)
      address = message.replace(match[0], '').replace(/[,\s]+$/, '').trim();
      break;
    }
  }

  // Also check for time at beginning
  if (!timeText) {
    const commaIndex = message.indexOf(',');
    if (commaIndex > 0) {
      const beforeComma = message.substring(0, commaIndex);
      const afterComma = message.substring(commaIndex + 1).trim();

      // Check if after comma is time-related
      const parsedTime = parseDeliveryTime(afterComma, timezone);
      if (parsedTime) {
        return { address: beforeComma.trim(), time: parsedTime };
      }
    }
  }

  const parsedTime = timeText ? parseDeliveryTime(timeText, timezone) : null;
  return { address: address || message, time: parsedTime };
}

/**
 * Format delivery time for display in business timezone
 * Format: DD-MM-YYYY, 12h time (e.g., "10-12-2025, 5:00 PM")
 * @param isoTime - ISO timestamp (stored in UTC)
 * @param timezone - IANA timezone (e.g., 'Asia/Kolkata'), defaults to 'Asia/Kolkata'
 */
export function formatDeliveryTime(isoTime: string, timezone: string = 'Asia/Kolkata'): string {
  const date = new Date(isoTime);
  const now = new Date();

  // Create formatters for the target timezone
  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Get today and tomorrow in target timezone for comparison
  const todayInTz = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowInTz = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(tomorrow);

  const dateInTz = dateFormatter.format(date);
  const timeStr = timeFormatter.format(date);

  if (dateInTz === todayInTz) {
    return `Today at ${timeStr}`;
  } else if (dateInTz === tomorrowInTz) {
    return `Tomorrow at ${timeStr}`;
  } else {
    // Format as DD-MM-YYYY
    return `${dateInTz} at ${timeStr}`;
  }
}

/**
 * Format date for display (DD-MM-YYYY format)
 * @param isoDate - ISO date string
 * @param timezone - IANA timezone (e.g., 'Asia/Kolkata')
 */
export function formatDateForDisplay(isoDate: string, timezone: string = 'Asia/Kolkata'): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
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

/**
 * Calculate datetime from interactive button selection
 * @param dateSelection - 'today' | 'tomorrow'
 * @param timeSelection - 'time_30min' | 'time_1hour' | 'time_1_5hour' | 'time_morning' | 'time_afternoon'
 * @param timezone - Business timezone
 * @returns ISO string in UTC
 */
export function calculateDateTimeFromButtons(
  dateSelection: 'today' | 'tomorrow',
  timeSelection: string,
  timezone: string = 'Asia/Kolkata'
): string | null {
  const tz = timezone || 'Asia/Kolkata';
  const nowInTz = getNowInTimezone(tz);

  if (isNaN(nowInTz.getTime())) {
    logger.error(`Invalid date from getNowInTimezone with timezone: ${tz}`);
    return null;
  }

  let targetDate = new Date(nowInTz);

  // Set to tomorrow if selected
  if (dateSelection === 'tomorrow') {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  let hours: number;
  let minutes: number = 0;

  switch (timeSelection) {
    case 'time_30min':
      // Add 30 minutes to current time (only valid for today)
      if (dateSelection === 'today') {
        targetDate = new Date(nowInTz);
        targetDate.setMinutes(targetDate.getMinutes() + 30);
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      } else {
        // Fallback to morning for tomorrow
        hours = 10;
      }
      break;

    case 'time_1hour':
      // Add 1 hour to current time (only valid for today)
      if (dateSelection === 'today') {
        targetDate = new Date(nowInTz);
        targetDate.setHours(targetDate.getHours() + 1);
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      } else {
        // Fallback to morning for tomorrow
        hours = 10;
      }
      break;

    case 'time_1_5hour':
      // Add 1.5 hours to current time (only valid for today)
      if (dateSelection === 'today') {
        targetDate = new Date(nowInTz);
        targetDate.setMinutes(targetDate.getMinutes() + 90);
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      } else {
        // Fallback to morning for tomorrow
        hours = 10;
      }
      break;

    case 'time_morning':
      hours = 10; // 10 AM
      break;

    case 'time_afternoon':
      hours = 14; // 2 PM
      break;

    case 'time_evening':
      hours = 18; // 6 PM
      break;

    default:
      return null;
  }

  return localToUTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    hours,
    minutes,
    tz
  );
}
