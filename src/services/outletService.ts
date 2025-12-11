import { supabase } from '../config/database';
import { BusinessOutlet } from '../types';
import { logger } from '../utils/logger';

/**
 * Get all active outlets for a business
 */
export async function getBusinessOutlets(businessId: string): Promise<BusinessOutlet[]> {
  const { data, error } = await supabase
    .from('business_outlets')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch outlets', error);
    return [];
  }

  return (data || []) as BusinessOutlet[];
}

/**
 * Get a single outlet by ID
 */
export async function getOutletById(outletId: string): Promise<BusinessOutlet | null> {
  const { data, error } = await supabase
    .from('business_outlets')
    .select('*')
    .eq('id', outletId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as BusinessOutlet;
}

/**
 * Format outlets list for customer display (WhatsApp message)
 */
export function formatOutletsForCustomer(outlets: BusinessOutlet[]): string {
  if (outlets.length === 0) {
    return 'No outlets available at the moment.';
  }

  let message = '📍 *Our Locations*\n\n';

  outlets.forEach((outlet, index) => {
    message += `${index + 1}. *${outlet.outlet_name}*\n`;
    message += `   ${outlet.address}\n`;
    if (outlet.phone) {
      message += `   📞 ${outlet.phone}\n`;
    }
    message += '\n';
  });

  message += '_Reply with the number (1, 2, 3...) to select your preferred outlet_';

  return message;
}

/**
 * Format outlets list for AI context
 */
export function formatOutletsForAI(outlets: BusinessOutlet[]): string {
  if (outlets.length === 0) {
    return 'No outlets available.';
  }

  let text = 'AVAILABLE OUTLETS:\n';
  outlets.forEach((outlet, index) => {
    text += `${index + 1}. ID: ${outlet.id} | Name: "${outlet.outlet_name}" | Address: ${outlet.address}\n`;
  });

  return text;
}

/**
 * Find outlet by customer response (number or name)
 */
export function findOutletByCustomerInput(
  input: string,
  outlets: BusinessOutlet[]
): BusinessOutlet | null {
  const normalizedInput = input.toLowerCase().trim();

  // Check if input is a number (1, 2, 3...)
  const numberMatch = normalizedInput.match(/^(\d+)$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1], 10) - 1;
    if (index >= 0 && index < outlets.length) {
      return outlets[index];
    }
  }

  // Check if input matches outlet name
  const matchedOutlet = outlets.find(outlet =>
    outlet.outlet_name.toLowerCase().includes(normalizedInput) ||
    normalizedInput.includes(outlet.outlet_name.toLowerCase())
  );

  return matchedOutlet || null;
}

/**
 * Create a new outlet (for admin/business dashboard)
 */
export async function createOutlet(
  businessId: string,
  outletData: {
    outlet_name: string;
    address: string;
    phone?: string;
    latitude?: number;
    longitude?: number;
    display_order?: number;
  }
): Promise<BusinessOutlet> {
  const { data, error } = await supabase
    .from('business_outlets')
    .insert({
      business_id: businessId,
      ...outletData,
      is_active: true,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create outlet', error);
    throw new Error('Failed to create outlet');
  }

  logger.info(`Outlet created: ${data.outlet_name}`);
  return data as BusinessOutlet;
}

/**
 * Update outlet details
 */
export async function updateOutlet(
  outletId: string,
  updates: Partial<BusinessOutlet>
): Promise<boolean> {
  const { error } = await supabase
    .from('business_outlets')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', outletId);

  if (error) {
    logger.error('Failed to update outlet', error);
    return false;
  }

  logger.info(`Outlet updated: ${outletId}`);
  return true;
}

/**
 * Deactivate an outlet (soft delete)
 */
export async function deactivateOutlet(outletId: string): Promise<boolean> {
  const { error } = await supabase
    .from('business_outlets')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', outletId);

  if (error) {
    logger.error('Failed to deactivate outlet', error);
    return false;
  }

  logger.info(`Outlet deactivated: ${outletId}`);
  return true;
}
