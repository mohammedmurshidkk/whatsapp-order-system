/**
 * Centralized location utilities
 * - Google Maps link generation
 * - Coordinate validation
 */

/**
 * Generate Google Maps link from coordinates
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns Google Maps URL or null if invalid coordinates
 */
export function generateGoogleMapsLink(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string | null {
  if (!isValidCoordinates(latitude, longitude)) {
    return null;
  }

  // Using maps.google.com format (works on all devices)
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}

/**
 * Generate Google Maps navigation link (for delivery boy)
 * Opens directly in navigation mode
 */
export function generateGoogleMapsNavLink(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): string | null {
  if (!isValidCoordinates(latitude, longitude)) {
    return null;
  }

  // dir mode opens navigation
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

/**
 * Check if coordinates are valid
 */
export function isValidCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined
): boolean {
  if (latitude === null || latitude === undefined) return false;
  if (longitude === null || longitude === undefined) return false;
  if (isNaN(latitude) || isNaN(longitude)) return false;

  // Valid lat range: -90 to 90
  // Valid lng range: -180 to 180
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;

  return true;
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  precision: number = 6
): string | null {
  if (!isValidCoordinates(latitude, longitude)) {
    return null;
  }

  return `${latitude!.toFixed(precision)}, ${longitude!.toFixed(precision)}`;
}
