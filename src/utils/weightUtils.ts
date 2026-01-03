/**
 * Weight parsing and calculation utilities for custom weight pricing
 */

export interface ParsedWeight {
  grams: number;
  displayString: string; // "1.5kg", "750g"
  isValid: boolean;
  error?: string;
}

/**
 * Parse weight string to grams
 * Supports: "1kg", "1.5kg", "500g", "750g", "2 kg", "1.25kg", etc.
 */
export function parseWeight(weight: string): ParsedWeight {
  const normalized = weight.toLowerCase().trim();

  // Pattern: number (with optional decimal) followed by kg or g
  const kgMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*kg$/);
  const gMatch = normalized.match(/^(\d+)\s*g$/);

  if (kgMatch) {
    const kg = parseFloat(kgMatch[1]);
    const grams = Math.round(kg * 1000);
    return {
      grams,
      displayString: kg % 1 === 0 ? `${kg}kg` : `${kg}kg`,
      isValid: true,
    };
  }

  if (gMatch) {
    const grams = parseInt(gMatch[1], 10);
    return {
      grams,
      displayString: `${grams}g`,
      isValid: grams >= 100, // Reasonable minimum
    };
  }

  return {
    grams: 0,
    displayString: weight,
    isValid: false,
    error: 'Invalid weight format. Use format like "1kg", "1.5kg", "500g"',
  };
}

/**
 * Format grams to display string
 * e.g., 1500 -> "1.5kg", 500 -> "500g", 2000 -> "2kg"
 */
export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = grams / 1000;
    return kg % 1 === 0 ? `${kg}kg` : `${kg}kg`;
  }
  return `${grams}g`;
}

/**
 * Check if a size string looks like a weight (e.g., "1kg", "500g", "1.5kg")
 */
export function isWeightString(size: string): boolean {
  const normalized = size.toLowerCase().trim();
  return /^\d+(?:\.\d+)?\s*(kg|g)$/.test(normalized);
}

/**
 * Check if weight meets minimum requirement
 */
export function validateMinWeight(
  grams: number,
  minGrams: number
): { isValid: boolean; error?: string } {
  if (grams < minGrams) {
    return {
      isValid: false,
      error: `Minimum weight is ${formatWeight(minGrams)}`,
    };
  }
  return { isValid: true };
}
