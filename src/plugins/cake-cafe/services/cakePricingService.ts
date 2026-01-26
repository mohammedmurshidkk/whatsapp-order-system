import { supabase } from '@/config/database';
import {
  CakeFlavorPricing,
  CakeFlavorSize,
  CakeFlavorWithWeights,
  CakeDesignElement,
  STANDARD_CAKE_DESIGN_ELEMENTS,
} from '@/types';
import { logger } from '@/utils/logger';

// ============================================
// COMBINED FLAVOR + WEIGHT PRICING CRUD
// ============================================

/**
 * Get all flavor pricing entries for a business
 * Each flavor has a sizes array with price and is_base flag
 */
export async function getFlavorPricings(businessId: string): Promise<CakeFlavorPricing[]> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('flavor_name', { ascending: true });

  if (error) {
    logger.error('Failed to fetch flavor pricings', error);
    return [];
  }

  // Ensure sizes is always an array
  return (data || []).map(item => ({
    ...item,
    sizes: Array.isArray(item.sizes) ? item.sizes : [],
  })) as CakeFlavorPricing[];
}

/**
 * Get flavor pricing grouped by flavor name
 * Converts sizes array to weights format for AI compatibility
 * Returns: { flavor_name: "Vanilla", weights: [{ weight_grams: 500, base_price: 600, is_base: false }, ...] }
 */
export async function getFlavorPricingsGrouped(businessId: string): Promise<CakeFlavorWithWeights[]> {
  const pricings = await getFlavorPricings(businessId);

  return pricings.map(pricing => ({
    flavor_name: pricing.flavor_name,
    weights: pricing.sizes.map(size => ({
      weight_grams: parseWeightFromString(size.name) || 0,
      base_price: size.price,
      is_base: size.is_base,
    })),
  }));
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
    .select('sizes')
    .eq('business_id', businessId)
    .ilike('flavor_name', flavorName)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    logger.error('Failed to fetch weights for flavor', error);
    return [];
  }

  const sizes = Array.isArray(data.sizes) ? data.sizes : [];
  return sizes
    .map((s: CakeFlavorSize) => parseWeightFromString(s.name) || 0)
    .filter((w: number) => w > 0)
    .sort((a: number, b: number) => a - b);
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

  return {
    ...data,
    sizes: Array.isArray(data.sizes) ? data.sizes : [],
  } as CakeFlavorPricing;
}

/**
 * Get flavor pricing by name
 */
export async function getFlavorPricingByName(
  businessId: string,
  flavorName: string
): Promise<CakeFlavorPricing | null> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('business_id', businessId)
    .ilike('flavor_name', flavorName)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    ...data,
    sizes: Array.isArray(data.sizes) ? data.sizes : [],
  } as CakeFlavorPricing;
}

export async function createFlavorPricing(
  businessId: string,
  flavorName: string,
  sizes: CakeFlavorSize[]
): Promise<CakeFlavorPricing> {
  // Validate sizes array
  if (!sizes || sizes.length === 0) {
    throw new Error('At least one size is required');
  }

  // Ensure exactly one is_base is true
  const baseCount = sizes.filter(s => s.is_base).length;
  if (baseCount === 0) {
    // Default first size as base if none specified
    sizes[0].is_base = true;
  } else if (baseCount > 1) {
    throw new Error('Only one size can be marked as base');
  }

  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert({
      business_id: businessId,
      flavor_name: flavorName,
      sizes: sizes,
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

  return {
    ...data,
    sizes: Array.isArray(data.sizes) ? data.sizes : [],
  } as CakeFlavorPricing;
}

export async function updateFlavorPricing(
  id: string,
  updates: Partial<Pick<CakeFlavorPricing, 'flavor_name' | 'sizes' | 'is_active'>>
): Promise<CakeFlavorPricing> {
  // If sizes is being updated, validate it
  if (updates.sizes) {
    if (updates.sizes.length === 0) {
      throw new Error('At least one size is required');
    }
    const baseCount = updates.sizes.filter(s => s.is_base).length;
    if (baseCount === 0) {
      updates.sizes[0].is_base = true;
    } else if (baseCount > 1) {
      throw new Error('Only one size can be marked as base');
    }
  }

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

  return {
    ...data,
    sizes: Array.isArray(data.sizes) ? data.sizes : [],
  } as CakeFlavorPricing;
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
 * Bulk create flavor pricings (multiple flavors at once)
 * Each flavor object should have flavor_name and sizes array
 */
export async function createFlavorPricingBulk(
  businessId: string,
  flavors: Array<{ flavor_name: string; sizes: CakeFlavorSize[] }>
): Promise<CakeFlavorPricing[]> {
  const records = flavors.map(f => {
    // Ensure one is_base per flavor
    const baseCount = f.sizes.filter(s => s.is_base).length;
    if (baseCount === 0 && f.sizes.length > 0) {
      f.sizes[0].is_base = true;
    }
    return {
      business_id: businessId,
      flavor_name: f.flavor_name,
      sizes: f.sizes,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert(records)
    .select();

  if (error) {
    logger.error('Failed to bulk create flavor pricing', error);
    throw new Error('Failed to bulk create flavor pricing');
  }

  return (data || []).map(item => ({
    ...item,
    sizes: Array.isArray(item.sizes) ? item.sizes : [],
  })) as CakeFlavorPricing[];
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
 * Convert CakeFlavorPricing[] to CakeFlavorWithWeights[] format
 * Used for AI prompt compatibility
 */
function groupFlavorPricings(pricings: CakeFlavorPricing[]): CakeFlavorWithWeights[] {
  return pricings.map(pricing => ({
    flavor_name: pricing.flavor_name,
    weights: pricing.sizes.map(size => ({
      weight_grams: parseWeightFromString(size.name) || 0,
      base_price: size.price,
      is_base: size.is_base,
    })),
  }));
}

// ============================================
// PRICE CALCULATION HELPERS
// ============================================

/**
 * Calculate price for a custom weight based on base price
 * Uses proportional calculation: (base_price / base_grams) * requested_grams
 * @param basePrice - Price of the base size
 * @param requestedGrams - Weight in grams that customer wants
 * @param baseGrams - Weight in grams of the base size (defaults to 1000g/1kg)
 */
export function calculateCustomWeightPrice(
  basePrice: number,
  requestedGrams: number,
  baseGrams: number = 1000
): number {
  const pricePerGram = basePrice / baseGrams;
  return Math.round(pricePerGram * requestedGrams);
}

/**
 * Find pricing for a flavor and weight
 * Uses is_base flag to determine which size to use for custom weight calculations
 */
export function findFlavorWeightPrice(
  flavorName: string,
  weightGrams: number,
  pricings: CakeFlavorPricing[]
): { price: number; isCalculated: boolean } | null {
  const normalizedFlavor = flavorName.toLowerCase().trim();

  // Find the flavor (exact match first)
  let flavorPricing = pricings.find(
    p => p.flavor_name.toLowerCase() === normalizedFlavor
  );

  // Try partial match if no exact match
  if (!flavorPricing) {
    flavorPricing = pricings.find(
      p => p.flavor_name.toLowerCase().includes(normalizedFlavor) ||
           normalizedFlavor.includes(p.flavor_name.toLowerCase())
    );
  }

  if (!flavorPricing || !flavorPricing.sizes || flavorPricing.sizes.length === 0) {
    return null;
  }

  const sizes = flavorPricing.sizes;

  // 1. Exact weight match in sizes
  for (const size of sizes) {
    const sizeGrams = parseWeightFromString(size.name);
    if (sizeGrams === weightGrams) {
      return { price: size.price, isCalculated: false };
    }
  }

  // 2. Calculate from base size (is_base = true)
  const baseSize = sizes.find(s => s.is_base);
  if (baseSize) {
    const baseGrams = parseWeightFromString(baseSize.name);
    if (baseGrams && baseGrams > 0) {
      const calculatedPrice = calculateCustomWeightPrice(baseSize.price, weightGrams, baseGrams);
      return { price: calculatedPrice, isCalculated: true };
    }
  }

  // 3. Fallback: calculate from first available size
  const firstSize = sizes[0];
  const firstGrams = parseWeightFromString(firstSize.name);
  if (firstGrams && firstGrams > 0) {
    const calculatedPrice = calculateCustomWeightPrice(firstSize.price, weightGrams, firstGrams);
    return { price: calculatedPrice, isCalculated: true };
  }

  return null;
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
        .map(w => {
          const baseMarker = w.is_base ? ' [BASE]' : '';
          return `${w.weight_grams}g: ₹${w.base_price}${baseMarker}`;
        })
        .join(', ');
      text += `- ${f.flavor_name}: ${weightPrices}\n`;
    });
    text += '\n💡 For custom weights, calculate from the [BASE] size price:\n';
    text += '   Example: If 1kg [BASE] = ₹900, then 2kg = ₹1800, 1.5kg = ₹1350\n';
    text += '   Formula: (base_price / base_weight) × requested_weight\n';
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
