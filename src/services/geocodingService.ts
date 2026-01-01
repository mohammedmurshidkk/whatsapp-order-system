import axios from 'axios';
import https from 'https';
import dns from 'dns';
import { logger } from '../utils/logger';

// Force IPv4 to avoid AWS IPv6 issues with some external services
dns.setDefaultResultOrder('ipv4first');

// Create HTTPS agent that forces IPv4
const httpsAgent = new https.Agent({
  family: 4, // Force IPv4
  timeout: 10000,
  keepAlive: true,
});

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
 * Configured with IPv4 preference for AWS compatibility
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
        'User-Agent': 'WhatsAppOrderingSystem/1.0 (contact@example.com)',
        'Accept-Language': 'en',
        'Accept': 'application/json',
      },
      timeout: 10000, // 10 second timeout (AWS can be slow)
      httpsAgent, // Force IPv4
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
  } catch (error: any) {
    // Log more details for debugging AWS-specific issues
    const errorDetails = {
      message: error?.message || 'Unknown error',
      code: error?.code || 'N/A',
      status: error?.response?.status || 'N/A',
    };
    logger.error(`Reverse geocoding failed for ${latitude}, ${longitude}:`, errorDetails);
    return null;
  }
}

/**
 * Get a short, human-readable address from coordinates
 * Falls back to coordinate string if geocoding fails
 *
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns Address string or null if geocoding fails
 */
export async function getAddressFromCoordinates(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const result = await reverseGeocode(latitude, longitude);

    if (result && result.address) {
      return result.address;
    }

    // Return null if geocoding fails - lat/long saved separately
    return null;
  } catch (error) {
    // Extra safety net - should not reach here but just in case
    logger.error(`getAddressFromCoordinates unexpected error:`, error);
    return null;
  }
}
