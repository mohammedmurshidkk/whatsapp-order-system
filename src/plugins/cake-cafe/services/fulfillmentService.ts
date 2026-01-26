import { TranslationKeys } from '../../../i18n';
import { supabase } from '@/config/database';
import { FulfillmentType, DeliveryFeeResult } from '@/types';
import { logger } from '@/utils/logger';
import { calculateDeliveryDistance } from '@/utils/distanceUtils';

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
 * IMPORTANT: Only updates fields that are explicitly provided.
 * If latitude/longitude are not provided, existing values are preserved.
 */
export async function updateSessionDeliveryInfo(
  sessionId: string,
  deliveryInfo: {
    address?: string | null; // Can be null if geocoding failed (lat/long still saved)
    geocoded_address?: string | null; // Auto-geocoded address from WhatsApp location
    time?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
  }
): Promise<void> {
  // Build update object with only provided fields
  // This prevents overwriting lat/long with NULL when AI extracts address text
  const updateData: Record<string, unknown> = {};

  // Only update address if explicitly provided (including null for clearing)
  if ('address' in deliveryInfo) {
    updateData.delivery_address = deliveryInfo.address || null;
  }

  // Only update geocoded_address if explicitly provided
  if ('geocoded_address' in deliveryInfo) {
    updateData.delivery_geocoded_address = deliveryInfo.geocoded_address || null;
  }

  if (deliveryInfo.time !== undefined) {
    updateData.delivery_time = deliveryInfo.time || null;
  }

  // Only update lat/long if explicitly provided (not undefined)
  if (deliveryInfo.latitude !== undefined) {
    updateData.delivery_latitude = deliveryInfo.latitude;
  }

  if (deliveryInfo.longitude !== undefined) {
    updateData.delivery_longitude = deliveryInfo.longitude;
  }

  if (deliveryInfo.notes !== undefined) {
    updateData.fulfillment_notes = deliveryInfo.notes || null;
  }

  // Skip update if nothing to update
  if (Object.keys(updateData).length === 0) {
    logger.info(`No delivery info to update for session ${sessionId}`);
    return;
  }

  const { error } = await supabase
    .from('sessions')
    .update(updateData)
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update delivery info', error);
    throw new Error('Failed to update delivery information');
  }

  logger.info(`Delivery info updated for session ${sessionId}: ${JSON.stringify(updateData)}`);
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
  try {
    // Get current UTC time
    const now = new Date();

    // Use a simpler approach - format and parse
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    };

    // Format date parts separately to avoid locale issues
    const yearFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' });
    const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: '2-digit' });
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: '2-digit' });
    const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false });
    const minuteFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: '2-digit' });
    const secondFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, second: '2-digit' });

    const year = yearFormatter.format(now);
    const month = monthFormatter.format(now);
    const day = dayFormatter.format(now);
    let hour = hourFormatter.format(now).replace(/\D/g, ''); // Remove non-digits
    const minute = minuteFormatter.format(now).padStart(2, '0');
    const second = secondFormatter.format(now).padStart(2, '0');

    // Ensure hour is 2 digits
    hour = hour.padStart(2, '0');

    // Handle hour24 edge case (some locales return 24 instead of 00)
    if (hour === '24') hour = '00';

    const dateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const result = new Date(dateStr);

    // Validate result
    if (isNaN(result.getTime())) {
      logger.error(`getNowInTimezone created invalid date from: ${dateStr}`);
      // Fallback to current server time
      return now;
    }

    return result;
  } catch (error) {
    logger.error(`getNowInTimezone error for timezone ${timezone}:`, error);
    // Fallback to current server time
    return new Date();
  }
}

/**
 * Convert a local datetime in a timezone to UTC ISO string
 * @param year - Year
 * @param month - Month (0-indexed, 0 = January)
 * @param day - Day of month
 * @param hours - Hours (0-23)
 * @param minutes - Minutes
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

    // Get the timezone offset in minutes for the target timezone
    // We use a known offset map for common timezones to avoid complex calculations
    const timezoneOffsets: Record<string, number> = {
      'Asia/Kolkata': 330,      // UTC+5:30
      'Asia/Dubai': 240,        // UTC+4
      'Asia/Singapore': 480,    // UTC+8
      'Europe/London': 0,       // UTC+0 (ignoring DST for simplicity)
      'America/New_York': -300, // UTC-5 (ignoring DST)
      'UTC': 0,
    };

    // Get offset in minutes (positive = ahead of UTC)
    let offsetMinutes = timezoneOffsets[tz];

    // If timezone not in map, try to calculate it
    if (offsetMinutes === undefined) {
      try {
        // Create a date and format it in both UTC and target timezone to find offset
        const testDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));
        const utcStr = testDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
        const tzStr = testDate.toLocaleString('en-US', { timeZone: tz, hour12: false });

        // Parse both strings to compare
        const utcParts = utcStr.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);
        const tzParts = tzStr.match(/(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+):(\d+)/);

        if (utcParts && tzParts) {
          const utcDate = new Date(parseInt(utcParts[3]), parseInt(utcParts[1]) - 1, parseInt(utcParts[2]),
            parseInt(utcParts[4]), parseInt(utcParts[5]), parseInt(utcParts[6]));
          const tzDate = new Date(parseInt(tzParts[3]), parseInt(tzParts[1]) - 1, parseInt(tzParts[2]),
            parseInt(tzParts[4]), parseInt(tzParts[5]), parseInt(tzParts[6]));

          offsetMinutes = (tzDate.getTime() - utcDate.getTime()) / (60 * 1000);
        } else {
          // Default to Asia/Kolkata if can't calculate
          offsetMinutes = 330;
        }
      } catch {
        offsetMinutes = 330; // Default to Asia/Kolkata
      }
    }

    // Create UTC time by subtracting the offset from local time
    // Local 2:00 PM in UTC+5:30 = 2:00 PM - 5:30 hours = 8:30 AM UTC
    const localDateUTC = Date.UTC(year, month, day, hours, minutes, 0);
    const utcMs = localDateUTC - (offsetMinutes * 60 * 1000);

    const result = new Date(utcMs).toISOString();
    logger.info(`localToUTC: ${year}-${month + 1}-${day} ${hours}:${minutes} in ${tz} (offset ${offsetMinutes}min) -> ${result}`);
    return result;
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

  // ============================================
  // Handle DD/MM/YY or DD/MM/YYYY date formats (e.g., "14/01/26", "14-01-2026", "14/01/26 11am")
  // ============================================
  const dateMatch = normalizedTime.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1; // JS months are 0-indexed
    let year = parseInt(dateMatch[3], 10);

    // Handle 2-digit year (26 -> 2026)
    if (year < 100) {
      year += 2000;
    }

    // Validate date is in the future
    const targetDate = new Date(year, month, day);
    if (targetDate < nowInTz) {
      // Date is in the past - try to extract time anyway for error context
      logger.warn(`Date ${day}/${month + 1}/${year} is in the past`);
    }

    // Try to extract time from the same input (e.g., "14/01/26 11am")
    // Remove the date part and check for time
    const timePartMatch = normalizedTime.replace(dateMatch[0], '').trim();
    const timeMatch = timePartMatch.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

    let hours = 12; // Default noon if no time specified
    let minutes = 0;

    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

      if (timeMatch[3]?.toLowerCase() === 'pm' && hours !== 12) {
        hours += 12;
      } else if (timeMatch[3]?.toLowerCase() === 'am' && hours === 12) {
        hours = 0;
      } else if (!timeMatch[3] && hours >= 1 && hours <= 6) {
        hours += 12; // Assume PM for business hours
      }
    }

    logger.info(`Parsed DD/MM/YY date: ${day}/${month + 1}/${year} ${hours}:${minutes.toString().padStart(2, '0')}`);
    return localToUTC(year, month, day, hours, minutes, tz);
  }

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
 * Always shows actual date in DD-MM-YYYY format to avoid confusion
 * Format: "DD-MM-YYYY at HH:MM AM/PM" (e.g., "30-12-2025 at 5:00 PM")
 * @param isoTime - ISO timestamp (stored in UTC)
 * @param timezone - IANA timezone (e.g., 'Asia/Kolkata'), defaults to 'Asia/Kolkata'
 */
export function formatDeliveryTime(
  isoTime: string,
  timezone: string = 'Asia/Kolkata',
  atTranslation: string = 'at'
): string {
  // Ensure timestamp is treated as UTC - PostgreSQL TIMESTAMP without timezone
  // may return without 'Z' suffix, causing JS to interpret as local time
  const normalizedTime = isoTime.endsWith('Z') || isoTime.includes('+') ? isoTime : isoTime + 'Z';
  const date = new Date(normalizedTime);
  // Handle undefined/null timezone explicitly
  const tz = timezone || 'Asia/Kolkata';

  // Create formatters for the target timezone
  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const dateInTz = dateFormatter.format(date);
  const timeStr = timeFormatter.format(date);

  // Always show actual date in DD-MM-YYYY format
  return `${dateInTz} ${atTranslation} ${timeStr}`.trim().replace(/ +/g, ' ');
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
 * Calculate delivery fee based on distance from outlet to customer
 * Uses configurable tiered pricing:
 * - Within free_radius: FREE
 * - Beyond free but within minimum_charge_distance: minimum_delivery_charge
 * - Beyond that: minimum_charge + (extra_km * increment_per_km)
 *
 * Distance calculation method is configurable per business:
 * - use_road_distance_api=true: Uses Google Maps API for accurate road distance
 * - use_road_distance_api=false: Uses straight-line distance × road_distance_multiplier
 */
export async function calculateDistanceBasedDeliveryFee(
  businessId: string,
  orderAmount: number,
  customerLat: number,
  customerLon: number
): Promise<DeliveryFeeResult> {
  // Fetch business pricing config including distance calculation settings
  const { data: business } = await supabase
    .from('businesses')
    .select(`
      delivery_fee,
      free_delivery_above,
      free_radius_meters,
      minimum_delivery_charge,
      minimum_charge_distance_meters,
      increment_per_km,
      max_delivery_radius_meters,
      road_distance_multiplier,
      use_road_distance_api
    `)
    .eq('id', businessId)
    .single();

  if (!business) {
    return { fee: 0, distance_meters: 0, is_beyond_max_radius: false };
  }

  // Fetch primary outlet coordinates (first active outlet by display_order)
  const { data: outlets } = await supabase
    .from('business_outlets')
    .select('latitude, longitude')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .limit(1);

  if (!outlets || outlets.length === 0 || !outlets[0].latitude || !outlets[0].longitude) {
    // No outlet with coordinates - fallback to flat fee
    logger.warn(`No outlet coordinates for business ${businessId}, using flat fee`);
    return {
      fee: business.delivery_fee || 0,
      distance_meters: 0,
      is_beyond_max_radius: false,
    };
  }

  const outlet = outlets[0];

  // Calculate distance using configurable method
  const distanceResult = await calculateDeliveryDistance(
    outlet.latitude,
    outlet.longitude,
    customerLat,
    customerLon,
    business.use_road_distance_api || false,
    business.road_distance_multiplier || 1.3,
    businessId
  );

  const distanceMeters = distanceResult.distance_meters;
  logger.info(`Distance calculated: ${(distanceMeters / 1000).toFixed(2)}km from outlet to customer (method: ${distanceResult.method})`);

  // Get pricing config with defaults
  const freeRadius = business.free_radius_meters || 3500; // 3.5km default
  const minimumCharge = business.minimum_delivery_charge || 30;
  const minimumChargeDistance = business.minimum_charge_distance_meters || 3000; // 3km billable distance for min charge
  const incrementPerKm = business.increment_per_km || 10;
  const maxRadius = business.max_delivery_radius_meters || 15000;

  // Calculate billable distance (distance beyond free radius)
  const billableDistance = Math.max(0, distanceMeters - freeRadius);

  // Calculate fee using standard formula (for all distances)
  let calculatedFee = 0;
  if (billableDistance <= 0) {
    calculatedFee = 0; // Within free radius
  } else if (billableDistance <= minimumChargeDistance) {
    calculatedFee = minimumCharge;
  } else {
    const additionalDistanceMeters = billableDistance - minimumChargeDistance;
    const additionalDistanceKm = additionalDistanceMeters / 1000;
    const additionalCharge = Math.floor(additionalDistanceKm) * incrementPerKm;
    calculatedFee = minimumCharge + additionalCharge;
  }

  // Check if beyond max radius
  const isBeyondMaxRadius = distanceMeters > maxRadius;
  if (isBeyondMaxRadius) {
    logger.info(`Beyond max radius (${(distanceMeters / 1000).toFixed(2)}km > ${maxRadius / 1000}km). Suggested fee: ₹${calculatedFee}`);
    return {
      fee: 0, // No automatic fee - requires admin approval
      distance_meters: distanceMeters,
      is_beyond_max_radius: true,
      suggested_fee: calculatedFee, // Admin can use this as auto-fill
    };
  }

  // Check free delivery threshold based on order amount
  if (business.free_delivery_above && orderAmount >= business.free_delivery_above) {
    return {
      fee: 0,
      distance_meters: distanceMeters,
      is_beyond_max_radius: false,
    };
  }

  // Within radius - return calculated fee
  if (billableDistance <= 0) {
    logger.info(`Delivery within free radius (${freeRadius}m), no charge`);
  } else {
    logger.info(`Delivery fee calculated: ${calculatedFee} (distance: ${(distanceMeters / 1000).toFixed(2)}km)`);
  }

  return {
    fee: calculatedFee,
    distance_meters: distanceMeters,
    is_beyond_max_radius: false,
  };
}

/**
 * Legacy function for backwards compatibility - uses flat fee
 * @deprecated Use calculateDistanceBasedDeliveryFee instead
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

/**
 * Validate if a requested time falls within outlet operating hours
 * @param requestedTimeUTC - ISO timestamp in UTC (from parseDeliveryTime)
 * @param outlet - BusinessOutlet with operating hours
 * @param timezone - Business timezone (e.g., 'Asia/Kolkata')
 * @returns { valid: true } or { valid: false, reason: string }
 */
export function validateOperatingHours(
  requestedTimeUTC: string,
  outlet: {
    opening_time?: string | null;
    closing_time?: string | null;
    opening_buffer_minutes?: number;
    closing_buffer_minutes?: number;
    opening_days?: string[] | null;
  },
  timezone: string = 'Asia/Kolkata'
): { valid: true } | { valid: false; reasonKey: keyof TranslationKeys['time'], reasonValues: Record<string, any> } {
  const tz = timezone || 'Asia/Kolkata';

  // If no operating hours set, allow any time
  if (!outlet.opening_time || !outlet.closing_time) {
    return { valid: true };
  }

  // Convert UTC to local time for comparison
  const normalizedTime = requestedTimeUTC.endsWith('Z') || requestedTimeUTC.includes('+')
    ? requestedTimeUTC
    : requestedTimeUTC + 'Z';
  const requestedDate = new Date(normalizedTime);

  // Get the day of week in the business timezone
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  });
  const requestedDayOfWeek = dayFormatter.format(requestedDate).toLowerCase();

  // Check if the day is in opening_days (if specified)
  if (outlet.opening_days && outlet.opening_days.length > 0) {
    const normalizedOpeningDays = outlet.opening_days.map(d => d.toLowerCase());
    if (!normalizedOpeningDays.includes(requestedDayOfWeek)) {
      return {
        valid: false,
        reasonKey: 'closedOnDay',
        reasonValues: {
          day: requestedDayOfWeek.charAt(0).toUpperCase() + requestedDayOfWeek.slice(1),
          openDays: outlet.opening_days.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', '),
        },
      };
    }
  }

  // Get hour and minute in local timezone
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  });
  const minuteFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    minute: '2-digit',
  });

  let localHour = parseInt(hourFormatter.format(requestedDate).replace(/\D/g, ''), 10);
  const localMinute = parseInt(minuteFormatter.format(requestedDate).replace(/\D/g, ''), 10);

  // Handle hour24 edge case
  if (localHour === 24) localHour = 0;

  // Convert to minutes from midnight for easier comparison
  const requestedMinutes = localHour * 60 + localMinute;

  // Parse opening and closing times (format: "HH:MM" in 24h)
  const [openHour, openMin] = outlet.opening_time.split(':').map(Number);
  const [closeHour, closeMin] = outlet.closing_time.split(':').map(Number);

  const openingBuffer = outlet.opening_buffer_minutes || 0;
  const closingBuffer = outlet.closing_buffer_minutes || 0;

  // Earliest allowed time = opening_time + opening_buffer
  const earliestAllowed = openHour * 60 + openMin + openingBuffer;
  // Latest allowed time = closing_time - closing_buffer
  const latestAllowed = closeHour * 60 + closeMin - closingBuffer;

  // Format time for error messages
  const formatTimeForDisplay = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m > 0 ? `${displayHour}:${m.toString().padStart(2, '0')} ${period}` : `${displayHour} ${period}`;
  };

  if (requestedMinutes < earliestAllowed) {
    return {
      valid: false,
      reasonKey: 'tooEarlySimple',
      reasonValues: { time: formatTimeForDisplay(earliestAllowed) },
    };
  }

  if (requestedMinutes > latestAllowed) {
    return {
      valid: false,
      reasonKey: 'tooLate',
      reasonValues: {
        closeTime: formatTimeForDisplay(closeHour * 60 + closeMin),
        latestTime: formatTimeForDisplay(latestAllowed)
      },
    };
  }

  return { valid: true };
}
