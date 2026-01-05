import { supabase } from '../config/database';
import {
  CakeFlavorPricing,
  CakeFlavorWithWeights,
  CakeDesignElement,
  STANDARD_CAKE_DESIGN_ELEMENTS,
} from '../types';
import { logger } from '../utils/logger';

// ============================================
// COMBINED FLAVOR + WEIGHT PRICING CRUD
// ============================================

/**
 * Get all flavor pricing entries for a business
 * Returns flat list of all flavor+weight combinations
 */
export async function getFlavorPricings(businessId: string): Promise<CakeFlavorPricing[]> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('flavor_name', { ascending: true })
    .order('weight_grams', { ascending: true });

  if (error) {
    logger.error('Failed to fetch flavor pricings', error);
    return [];
  }

  return (data || []) as CakeFlavorPricing[];
}

/**
 * Get flavor pricing grouped by flavor name
 * Returns: { flavor_name: "Vanilla", weights: [{ weight_grams: 500, base_price: 600 }, ...] }
 */
export async function getFlavorPricingsGrouped(businessId: string): Promise<CakeFlavorWithWeights[]> {
  const pricings = await getFlavorPricings(businessId);

  const groupedMap = new Map<string, CakeFlavorWithWeights>();

  for (const pricing of pricings) {
    const existing = groupedMap.get(pricing.flavor_name);
    if (existing) {
      existing.weights.push({
        weight_grams: pricing.weight_grams,
        base_price: pricing.base_price,
      });
    } else {
      groupedMap.set(pricing.flavor_name, {
        flavor_name: pricing.flavor_name,
        weights: [{
          weight_grams: pricing.weight_grams,
          base_price: pricing.base_price,
        }],
      });
    }
  }

  return Array.from(groupedMap.values());
}

/**
 * Get available flavors (unique flavor names)
 */
export async function getAvailableFlavors(businessId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('flavor_name')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (error) {
    logger.error('Failed to fetch available flavors', error);
    return [];
  }

  // Get unique flavor names
  const flavors = new Set((data || []).map(d => d.flavor_name));
  return Array.from(flavors).sort();
}

/**
 * Get available weights for a specific flavor
 */
export async function getWeightsForFlavor(businessId: string, flavorName: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('weight_grams')
    .eq('business_id', businessId)
    .eq('flavor_name', flavorName)
    .eq('is_active', true)
    .order('weight_grams', { ascending: true });

  if (error) {
    logger.error('Failed to fetch weights for flavor', error);
    return [];
  }

  return (data || []).map(d => d.weight_grams);
}

export async function getFlavorPricingById(id: string): Promise<CakeFlavorPricing | null> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakeFlavorPricing;
}

/**
 * Get specific pricing for a flavor+weight combination
 */
export async function getFlavorWeightPricing(
  businessId: string,
  flavorName: string,
  weightGrams: number
): Promise<CakeFlavorPricing | null> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('business_id', businessId)
    .ilike('flavor_name', flavorName)
    .eq('weight_grams', weightGrams)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakeFlavorPricing;
}

export async function createFlavorPricing(
  businessId: string,
  flavorName: string,
  weightGrams: number,
  basePrice: number
): Promise<CakeFlavorPricing> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert({
      business_id: businessId,
      flavor_name: flavorName,
      weight_grams: weightGrams,
      base_price: basePrice,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create flavor pricing', error);
    throw new Error('Failed to create flavor pricing');
  }

  return data as CakeFlavorPricing;
}

export async function updateFlavorPricing(
  id: string,
  updates: Partial<Pick<CakeFlavorPricing, 'flavor_name' | 'weight_grams' | 'base_price' | 'is_active'>>
): Promise<CakeFlavorPricing> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update flavor pricing', error);
    throw new Error('Failed to update flavor pricing');
  }

  return data as CakeFlavorPricing;
}

export async function deleteFlavorPricing(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('cake_flavor_pricing')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete flavor pricing', error);
    return false;
  }

  return true;
}

/**
 * Bulk create flavor pricing entries
 * Useful for adding all weights for a new flavor at once
 */
export async function createFlavorPricingBulk(
  businessId: string,
  flavorName: string,
  weights: Array<{ weight_grams: number; base_price: number }>
): Promise<CakeFlavorPricing[]> {
  const records = weights.map(w => ({
    business_id: businessId,
    flavor_name: flavorName,
    weight_grams: w.weight_grams,
    base_price: w.base_price,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert(records)
    .select();

  if (error) {
    logger.error('Failed to bulk create flavor pricing', error);
    throw new Error('Failed to bulk create flavor pricing');
  }

  return (data || []) as CakeFlavorPricing[];
}

// ============================================
// DESIGN ELEMENTS CRUD
// ============================================

export async function getDesignElements(businessId: string): Promise<CakeDesignElement[]> {
  const { data, error } = await supabase
    .from('cake_design_elements')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch design elements', error);
    return [];
  }

  return (data || []) as CakeDesignElement[];
}

export async function getDesignElementById(id: string): Promise<CakeDesignElement | null> {
  const { data, error } = await supabase
    .from('cake_design_elements')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakeDesignElement;
}

export async function createDesignElement(
  businessId: string,
  elementKey: string,
  elementLabel: string,
  price: number,
  priceType: 'fixed' | 'per_unit' = 'fixed'
): Promise<CakeDesignElement> {
  // Get max sort_order for this business
  const { data: existing } = await supabase
    .from('cake_design_elements')
    .select('sort_order')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from('cake_design_elements')
    .insert({
      business_id: businessId,
      element_key: elementKey,
      element_label: elementLabel,
      price: price,
      price_type: priceType,
      is_active: true,
      sort_order: nextOrder,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create design element', error);
    throw new Error('Failed to create design element');
  }

  return data as CakeDesignElement;
}

export async function updateDesignElement(
  id: string,
  updates: Partial<Pick<CakeDesignElement, 'element_key' | 'element_label' | 'price' | 'price_type' | 'is_active' | 'sort_order'>>
): Promise<CakeDesignElement> {
  const { data, error } = await supabase
    .from('cake_design_elements')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update design element', error);
    throw new Error('Failed to update design element');
  }

  return data as CakeDesignElement;
}

export async function deleteDesignElement(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('cake_design_elements')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete design element', error);
    return false;
  }

  return true;
}

// ============================================
// SEED STANDARD ELEMENTS
// ============================================

export async function seedStandardDesignElements(businessId: string): Promise<number> {
  let created = 0;

  for (let i = 0; i < STANDARD_CAKE_DESIGN_ELEMENTS.length; i++) {
    const element = STANDARD_CAKE_DESIGN_ELEMENTS[i];

    // Check if already exists
    const { data: existing } = await supabase
      .from('cake_design_elements')
      .select('id')
      .eq('business_id', businessId)
      .eq('element_key', element.element_key)
      .single();

    if (!existing) {
      const { error } = await supabase
        .from('cake_design_elements')
        .insert({
          business_id: businessId,
          element_key: element.element_key,
          element_label: element.element_label,
          price: element.default_price,
          price_type: element.price_type,
          is_active: true,
          sort_order: i,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (!error) {
        created++;
      }
    }
  }

  logger.info(`Seeded ${created} standard design elements for business ${businessId}`);
  return created;
}

// ============================================
// GET FULL PRICING CONFIG
// ============================================

export interface CakePricingConfig {
  weights: any;
  flavors: CakeFlavorPricing[];
  flavorsGrouped: CakeFlavorWithWeights[];
  designElements: CakeDesignElement[];
}

export async function getFullPricingConfig(businessId: string): Promise<CakePricingConfig> {
  const [flavors, designElements] = await Promise.all([
    getFlavorPricings(businessId),
    getDesignElements(businessId),
  ]);

  // Group flavors for display
  const flavorsGrouped = groupFlavorPricings(flavors);

  return { flavors, flavorsGrouped, designElements, weights: 77 };
}

/**
 * Group flat flavor pricings into grouped format
 */
function groupFlavorPricings(pricings: CakeFlavorPricing[]): CakeFlavorWithWeights[] {
  const groupedMap = new Map<string, CakeFlavorWithWeights>();

  for (const pricing of pricings) {
    const existing = groupedMap.get(pricing.flavor_name);
    if (existing) {
      existing.weights.push({
        weight_grams: pricing.weight_grams,
        base_price: pricing.base_price,
      });
    } else {
      groupedMap.set(pricing.flavor_name, {
        flavor_name: pricing.flavor_name,
        weights: [{
          weight_grams: pricing.weight_grams,
          base_price: pricing.base_price,
        }],
      });
    }
  }

  return Array.from(groupedMap.values());
}

// ============================================
// PRICE CALCULATION HELPERS
// ============================================

/**
 * Calculate price for a custom weight based on 1kg price
 * Uses proportional calculation: (1kg_price / 1000) * requested_grams
 */
export function calculateCustomWeightPrice(
  oneKgPrice: number,
  requestedGrams: number
): number {
  const pricePerGram = oneKgPrice / 1000;
  return Math.round(pricePerGram * requestedGrams);
}

/**
 * Find pricing for a flavor and weight
 * If exact weight not found, calculates from 1kg price
 */
export function findFlavorWeightPrice(
  flavorName: string,
  weightGrams: number,
  pricings: CakeFlavorPricing[]
): { price: number; isCalculated: boolean } | null {
  const normalizedFlavor = flavorName.toLowerCase().trim();

  // Filter to this flavor
  const flavorPricings = pricings.filter(
    p => p.flavor_name.toLowerCase() === normalizedFlavor
  );

  if (flavorPricings.length === 0) {
    // Try partial match
    const partialMatch = pricings.filter(
      p => p.flavor_name.toLowerCase().includes(normalizedFlavor) ||
           normalizedFlavor.includes(p.flavor_name.toLowerCase())
    );
    if (partialMatch.length > 0) {
      return findFlavorWeightPrice(partialMatch[0].flavor_name, weightGrams, pricings);
    }
    return null;
  }

  // 1. Exact weight match
  const exactMatch = flavorPricings.find(p => p.weight_grams === weightGrams);
  if (exactMatch) {
    return { price: exactMatch.base_price, isCalculated: false };
  }

  // 2. Calculate from 1kg price (1000g)
  const oneKgPricing = flavorPricings.find(p => p.weight_grams === 1000);
  if (oneKgPricing) {
    const calculatedPrice = calculateCustomWeightPrice(oneKgPricing.base_price, weightGrams);
    return { price: calculatedPrice, isCalculated: true };
  }

  // 3. Fallback: calculate from highest available weight
  const sorted = [...flavorPricings].sort((a, b) => b.weight_grams - a.weight_grams);
  const highest = sorted[0];
  const pricePerGram = highest.base_price / highest.weight_grams;
  const calculatedPrice = Math.round(pricePerGram * weightGrams);

  return { price: calculatedPrice, isCalculated: true };
}

/**
 * Find flavor pricing by name (fuzzy match)
 */
export function findFlavorPricing(
  flavorName: string,
  pricings: CakeFlavorPricing[]
): CakeFlavorPricing[] {
  const normalized = flavorName.toLowerCase().trim();

  // Exact match first
  let found = pricings.filter(p => p.flavor_name.toLowerCase() === normalized);

  if (found.length === 0) {
    // Partial match
    found = pricings.filter(p =>
      p.flavor_name.toLowerCase().includes(normalized) ||
      normalized.includes(p.flavor_name.toLowerCase())
    );
  }

  return found;
}

// ============================================
// HELPER: Parse weight from string
// ============================================

export function parseWeightFromString(weightStr: string): number | null {
  const normalized = weightStr.toLowerCase().trim();

  // Match patterns like "1kg", "1.5kg", "500g", "1 kg", "1.5 KG", "half kg", etc.
  const kgMatch = normalized.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (kgMatch) {
    return Math.round(parseFloat(kgMatch[1]) * 1000);
  }

  const gMatch = normalized.match(/(\d+)\s*g(?:rams?)?/);
  if (gMatch) {
    return parseInt(gMatch[1], 10);
  }

  // Handle words
  if (normalized.includes('half kg') || normalized.includes('half kilo')) {
    return 500;
  }
  if (normalized.includes('quarter kg') || normalized.includes('quarter kilo')) {
    return 250;
  }

  return null;
}

// ============================================
// FORMAT PRICING CONFIG FOR AI
// ============================================

export function formatPricingConfigForAI(config: CakePricingConfig): string {
  let text = '## CUSTOM CAKE PRICING\n\n';

  text += '### FLAVOR + WEIGHT PRICING:\n';
  if (config.flavorsGrouped.length === 0) {
    text += 'No flavor pricing configured.\n';
  } else {
    config.flavorsGrouped.forEach(f => {
      const weightPrices = f.weights
        .map(w => `${w.weight_grams}g: ₹${w.base_price}`)
        .join(', ');
      text += `- ${f.flavor_name}: ${weightPrices}\n`;
    });
    text += '\n💡 For custom weights (e.g., 2kg, 3kg), calculate from 1kg price:\n';
    text += '   2kg = 1kg price × 2, 1.5kg = 1kg price × 1.5, etc.\n';
  }

  text += '\n### DESIGN ELEMENT PRICING:\n';
  if (config.designElements.length === 0) {
    text += 'No design elements configured.\n';
  } else {
    config.designElements.forEach(e => {
      const priceStr = e.price_type === 'per_unit' ? `₹${e.price} per unit` : `₹${e.price}`;
      text += `- ${e.element_key} ("${e.element_label}"): ${priceStr}\n`;
    });
  }

  return text;
}
