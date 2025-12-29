import axios from 'axios';
import { logger } from '../utils/logger';

interface ReverseGeocodeResult {
  address: string;
  displayName: string;
  road?: string;
  suburb?: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * Reverse geocode coordinates to address using Nominatim (OpenStreetMap)
 * Free service, no API key required, but has rate limits (1 request/second)
 *
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns Address string or null if failed
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse`;

    const response = await axios.get(url, {
      params: {
        lat: latitude,
        lon: longitude,
        format: 'json',
        addressdetails: 1,
        zoom: 18, // High detail level
      },
      headers: {
        // Nominatim requires a User-Agent header
        'User-Agent': 'WhatsAppOrderingSystem/1.0',
        'Accept-Language': 'en',
      },
      timeout: 5000, // 5 second timeout
    });

    if (response.data && response.data.display_name) {
      const data = response.data;
      const address = data.address || {};

      // Build a clean, readable address
      const addressParts: string[] = [];

      // Add road/street if available
      if (address.road) {
        addressParts.push(address.road);
      } else if (address.pedestrian) {
        addressParts.push(address.pedestrian);
      }

      // Add house number if available
      if (address.house_number && addressParts.length > 0) {
        addressParts[0] = `${address.house_number} ${addressParts[0]}`;
      }

      // Add suburb/neighbourhood
      if (address.suburb) {
        addressParts.push(address.suburb);
      } else if (address.neighbourhood) {
        addressParts.push(address.neighbourhood);
      }

      // Add city/town/village
      const city = address.city || address.town || address.village || address.municipality;
      if (city) {
        addressParts.push(city);
      }

      // Add state if different from city
      if (address.state && address.state !== city) {
        addressParts.push(address.state);
      }

      // Build final address string
      const cleanAddress = addressParts.length > 0
        ? addressParts.join(', ')
        : data.display_name.split(',').slice(0, 4).join(', '); // Fallback to first 4 parts of display_name

      logger.info(`Reverse geocoded: ${latitude}, ${longitude} -> ${cleanAddress}`);

      return {
        address: cleanAddress,
        displayName: data.display_name,
        road: address.road,
        suburb: address.suburb,
        city: city,
        state: address.state,
        country: address.country,
      };
    }

    logger.warn(`No address found for coordinates: ${latitude}, ${longitude}`);
    return null;
  } catch (error) {
    logger.error(`Reverse geocoding failed for ${latitude}, ${longitude}:`, error);
    return null;
  }
}

/**
 * Get a short, human-readable address from coordinates
 * Falls back to coordinate string if geocoding fails
 *
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns Address string (never null)
 */
export async function getAddressFromCoordinates(
  latitude: number,
  longitude: number
): Promise<string> {
  const result = await reverseGeocode(latitude, longitude);

  if (result && result.address) {
    return result.address;
  }

  // Fallback to coordinates if geocoding fails
  return `Location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
