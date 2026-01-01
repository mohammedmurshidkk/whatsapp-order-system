import { supabase } from '../config/database';
import {
  CakeWeightPricing,
  CakeFlavorPricing,
  CakeDesignElement,
  STANDARD_CAKE_DESIGN_ELEMENTS,
} from '../types';
import { logger } from '../utils/logger';

// ============================================
// WEIGHT PRICING CRUD
// ============================================

export async function getWeightPricings(businessId: string): Promise<CakeWeightPricing[]> {
  const { data, error } = await supabase
    .from('cake_weight_pricing')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('weight_grams', { ascending: true });

  if (error) {
    logger.error('Failed to fetch weight pricings', error);
    return [];
  }

  return (data || []) as CakeWeightPricing[];
}

export async function getWeightPricingById(id: string): Promise<CakeWeightPricing | null> {
  const { data, error } = await supabase
    .from('cake_weight_pricing')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakeWeightPricing;
}

export async function createWeightPricing(
  businessId: string,
  weightGrams: number,
  basePrice: number
): Promise<CakeWeightPricing> {
  const { data, error } = await supabase
    .from('cake_weight_pricing')
    .insert({
      business_id: businessId,
      weight_grams: weightGrams,
      base_price: basePrice,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create weight pricing', error);
    throw new Error('Failed to create weight pricing');
  }

  return data as CakeWeightPricing;
}

export async function updateWeightPricing(
  id: string,
  updates: Partial<Pick<CakeWeightPricing, 'weight_grams' | 'base_price' | 'is_active'>>
): Promise<CakeWeightPricing> {
  const { data, error } = await supabase
    .from('cake_weight_pricing')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update weight pricing', error);
    throw new Error('Failed to update weight pricing');
  }

  return data as CakeWeightPricing;
}

export async function deleteWeightPricing(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('cake_weight_pricing')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Failed to delete weight pricing', error);
    return false;
  }

  return true;
}

// ============================================
// FLAVOR PRICING CRUD
// ============================================

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

  return (data || []) as CakeFlavorPricing[];
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

export async function createFlavorPricing(
  businessId: string,
  flavorName: string,
  additionalPrice: number
): Promise<CakeFlavorPricing> {
  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert({
      business_id: businessId,
      flavor_name: flavorName,
      additional_price: additionalPrice,
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
  updates: Partial<Pick<CakeFlavorPricing, 'flavor_name' | 'additional_price' | 'is_active'>>
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
  weights: CakeWeightPricing[];
  flavors: CakeFlavorPricing[];
  designElements: CakeDesignElement[];
}

export async function getFullPricingConfig(businessId: string): Promise<CakePricingConfig> {
  const [weights, flavors, designElements] = await Promise.all([
    getWeightPricings(businessId),
    getFlavorPricings(businessId),
    getDesignElements(businessId),
  ]);

  return { weights, flavors, designElements };
}

// ============================================
// HELPER: Find pricing by weight
// ============================================

export function findWeightPricing(
  weightGrams: number,
  pricings: CakeWeightPricing[]
): CakeWeightPricing | null {
  // Exact match first
  let found = pricings.find(p => p.weight_grams === weightGrams);

  if (!found) {
    // Find closest weight that's >= requested weight
    const sorted = [...pricings].sort((a, b) => a.weight_grams - b.weight_grams);
    found = sorted.find(p => p.weight_grams >= weightGrams);
  }

  return found || null;
}

// ============================================
// HELPER: Find flavor pricing by name
// ============================================

export function findFlavorPricing(
  flavorName: string,
  pricings: CakeFlavorPricing[]
): CakeFlavorPricing | null {
  const normalized = flavorName.toLowerCase().trim();

  // Exact match first
  let found = pricings.find(p => p.flavor_name.toLowerCase() === normalized);

  if (!found) {
    // Partial match
    found = pricings.find(p =>
      p.flavor_name.toLowerCase().includes(normalized) ||
      normalized.includes(p.flavor_name.toLowerCase())
    );
  }

  return found || null;
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
  let text = '## BUSINESS PRICING CONFIGURATION\n\n';

  text += '### WEIGHT PRICING:\n';
  if (config.weights.length === 0) {
    text += 'No weight pricing configured.\n';
  } else {
    config.weights.forEach(w => {
      text += `- ${w.weight_grams}g (${w.weight_grams / 1000}kg): ₹${w.base_price}\n`;
    });
  }

  text += '\n### FLAVOR PRICING (additional to base):\n';
  if (config.flavors.length === 0) {
    text += 'No flavor pricing configured.\n';
  } else {
    config.flavors.forEach(f => {
      text += `- ${f.flavor_name}: +₹${f.additional_price}\n`;
    });
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
