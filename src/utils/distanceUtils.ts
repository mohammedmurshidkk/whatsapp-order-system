/**
 * Distance calculation utilities
 * - Haversine formula for straight-line distance
 * - Google Maps Distance Matrix API for road distance
 */

import { logger } from './logger';
import { trackGoogleMapsUsage } from '../services/usageService';

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the distance between two geographic coordinates using the Haversine formula
 * @param lat1 - Latitude of point 1 (outlet)
 * @param lon1 - Longitude of point 1 (outlet)
 * @param lat2 - Latitude of point 2 (customer)
 * @param lon2 - Longitude of point 2 (customer)
 * @returns Distance in meters
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Format distance for display
 * @param meters - Distance in meters
 * @returns Formatted string (e.g., "2.5 km" or "800 m")
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Get road distance using Google Maps Distance Matrix API
 * @param originLat - Latitude of origin (outlet)
 * @param originLon - Longitude of origin (outlet)
 * @param destLat - Latitude of destination (customer)
 * @param destLon - Longitude of destination (customer)
 * @param businessId - Optional business ID for usage tracking
 * @returns Distance in meters, or null if API call fails
 */
export async function getRoadDistanceFromAPI(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  businessId?: string
): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    logger.warn('GOOGLE_MAPS_API_KEY not configured, cannot get road distance');
    return null;
  }

  const startTime = Date.now();

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLon}&destinations=${destLat},${destLon}&key=${apiKey}`;

    const response = await fetch(url);
    const data: any = await response.json();
    const latencyMs = Date.now() - startTime;

    if (data.status !== 'OK') {
      logger.error(`Google Maps API error: ${data.status}`, data.error_message);
      if (businessId) {
        trackGoogleMapsUsage({
          businessId,
          latencyMs,
          success: false,
          errorMessage: `API error: ${data.status}`,
        }).catch(() => {});
      }
      return null;
    }

    const element = data.rows?.[0]?.elements?.[0];

    if (element?.status !== 'OK') {
      logger.error(`Google Maps element error: ${element?.status}`);
      if (businessId) {
        trackGoogleMapsUsage({
          businessId,
          latencyMs,
          success: false,
          errorMessage: `Element error: ${element?.status}`,
        }).catch(() => {});
      }
      return null;
    }

    const distanceMeters = element.distance.value;
    logger.info(`Road distance from API: ${(distanceMeters / 1000).toFixed(2)}km`);

    // Track successful API call
    if (businessId) {
      trackGoogleMapsUsage({
        businessId,
        distanceMeters,
        latencyMs,
        success: true,
      }).catch(() => {});
    }

    return distanceMeters;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error('Failed to get road distance from Google Maps API:', error);
    if (businessId) {
      trackGoogleMapsUsage({
        businessId,
        latencyMs,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {});
    }
    return null;
  }
}

/**
 * Calculate distance with configurable method
 * @param originLat - Latitude of origin (outlet)
 * @param originLon - Longitude of origin (outlet)
 * @param destLat - Latitude of destination (customer)
 * @param destLon - Longitude of destination (customer)
 * @param useRoadDistanceAPI - If true, use Google Maps API for road distance
 * @param roadDistanceMultiplier - Multiplier for straight-line distance (used as fallback)
 * @param businessId - Optional business ID for usage tracking
 * @returns Distance in meters
 */
export async function calculateDeliveryDistance(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  useRoadDistanceAPI: boolean = false,
  roadDistanceMultiplier: number = 1.3,
  businessId?: string
): Promise<{ distance_meters: number; method: 'api' | 'multiplier' | 'straight_line' }> {
  // Always calculate straight-line as baseline
  const straightLineDistance = calculateDistanceMeters(originLat, originLon, destLat, destLon);

  // Try API if enabled
  if (useRoadDistanceAPI) {
    const roadDistance = await getRoadDistanceFromAPI(originLat, originLon, destLat, destLon, businessId);

    if (roadDistance !== null) {
      return {
        distance_meters: roadDistance,
        method: 'api',
      };
    }

    // API failed, fall through to multiplier
    logger.warn('Road distance API failed, falling back to multiplier');
  }

  // Use multiplier if configured (> 1.0)
  if (roadDistanceMultiplier > 1.0) {
    const estimatedRoadDistance = straightLineDistance * roadDistanceMultiplier;
    logger.info(`Estimated road distance: ${(estimatedRoadDistance / 1000).toFixed(2)}km (straight-line ${(straightLineDistance / 1000).toFixed(2)}km × ${roadDistanceMultiplier})`);

    return {
      distance_meters: estimatedRoadDistance,
      method: 'multiplier',
    };
  }

  // Return straight-line distance
  return {
    distance_meters: straightLineDistance,
    method: 'straight_line',
  };
}
