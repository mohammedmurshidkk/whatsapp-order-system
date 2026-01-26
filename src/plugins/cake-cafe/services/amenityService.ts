import { supabase } from '@/config/database';
import { BusinessAmenity } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Get all active amenities for a business
 */
export async function getBusinessAmenities(businessId: string): Promise<BusinessAmenity[]> {
  const { data, error } = await supabase
    .from('business_amenities')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch amenities', error);
    return [];
  }

  return (data || []) as BusinessAmenity[];
}

/**
 * Get all amenities for a business (including inactive) - for admin
 */
export async function getAllBusinessAmenities(businessId: string): Promise<BusinessAmenity[]> {
  const { data, error } = await supabase
    .from('business_amenities')
    .select('*')
    .eq('business_id', businessId)
    .order('display_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch all amenities', error);
    return [];
  }

  return (data || []) as BusinessAmenity[];
}

/**
 * Get a single amenity by ID
 */
export async function getAmenityById(amenityId: string): Promise<BusinessAmenity | null> {
  const { data, error } = await supabase
    .from('business_amenities')
    .select('*')
    .eq('id', amenityId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as BusinessAmenity;
}

/**
 * Get amenity by slug for a business (for AI matching)
 */
export async function getAmenityBySlug(
  businessId: string,
  slug: string
): Promise<BusinessAmenity | null> {
  const { data, error } = await supabase
    .from('business_amenities')
    .select('*')
    .eq('business_id', businessId)
    .eq('slug', slug.toLowerCase())
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  return data as BusinessAmenity;
}

/**
 * Format amenities list for AI context
 */
export function formatAmenitiesForAI(amenities: BusinessAmenity[]): string {
  if (amenities.length === 0) {
    return 'No amenities available.';
  }

  let text = 'AVAILABLE AMENITIES/SERVICES (not food items):\n';
  amenities.forEach((amenity) => {
    text += `- slug: "${amenity.slug}" | name: "${amenity.name}"\n`;
  });

  return text;
}

/**
 * Create a new amenity
 */
export async function createAmenity(
  businessId: string,
  amenityData: {
    name: string;
    slug: string;
    description: string;
    image_url?: string | null;
    images?: string[];
    display_order?: number;
  }
): Promise<BusinessAmenity> {
  // Normalize slug
  const normalizedSlug = amenityData.slug.toLowerCase().replace(/\s+/g, '_');

  const { data, error } = await supabase
    .from('business_amenities')
    .insert({
      business_id: businessId,
      name: amenityData.name,
      slug: normalizedSlug,
      description: amenityData.description,
      image_url: amenityData.image_url || null,
      images: amenityData.images || [],
      display_order: amenityData.display_order || 0,
      is_active: true,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create amenity', error);
    throw new Error('Failed to create amenity');
  }

  logger.info(`Amenity created: ${data.name}`);
  return data as BusinessAmenity;
}

/**
 * Update amenity details
 */
export async function updateAmenity(
  amenityId: string,
  updates: Partial<BusinessAmenity>
): Promise<boolean> {
  // Normalize slug if provided
  if (updates.slug) {
    updates.slug = updates.slug.toLowerCase().replace(/\s+/g, '_');
  }

  const { error } = await supabase
    .from('business_amenities')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', amenityId);

  if (error) {
    logger.error('Failed to update amenity', error);
    return false;
  }

  logger.info(`Amenity updated: ${amenityId}`);
  return true;
}

/**
 * Delete an amenity (hard delete)
 */
export async function deleteAmenity(amenityId: string): Promise<boolean> {
  const { error } = await supabase
    .from('business_amenities')
    .delete()
    .eq('id', amenityId);

  if (error) {
    logger.error('Failed to delete amenity', error);
    return false;
  }

  logger.info(`Amenity deleted: ${amenityId}`);
  return true;
}

/**
 * Toggle amenity active status
 */
export async function toggleAmenityStatus(
  amenityId: string,
  isActive: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from('business_amenities')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', amenityId);

  if (error) {
    logger.error('Failed to toggle amenity status', error);
    return false;
  }

  logger.info(`Amenity ${amenityId} status set to: ${isActive}`);
  return true;
}
