/**
 * Feature Service
 * Manages tenant feature flags for multi-tenant feature management
 */

import { supabase } from '../config/database';
import { logger } from '../utils/logger';

export interface FeatureDefinition {
  feature_key: string;
  display_name: string;
  description: string;
  category: string;
  default_enabled: boolean;
  sort_order: number;
}

export interface TenantFeature {
  id: string;
  business_id: string;
  feature_key: string;
  is_enabled: boolean;
  enabled_at: string | null;
  enabled_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureUpdate {
  feature_key: string;
  is_enabled: boolean;
}

/**
 * Get all feature definitions
 */
export async function getAllFeatureDefinitions(): Promise<FeatureDefinition[]> {
  const { data, error } = await supabase
    .from('feature_definitions')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    logger.error('Failed to get feature definitions', { error });
    throw new Error('Failed to get feature definitions');
  }

  return data || [];
}

/**
 * Get all features for a specific business
 */
export async function getBusinessFeatures(businessId: string): Promise<TenantFeature[]> {
  const { data, error } = await supabase
    .from('tenant_features')
    .select('*')
    .eq('business_id', businessId)
    .order('feature_key', { ascending: true });

  if (error) {
    logger.error('Failed to get business features', { error, businessId });
    throw new Error('Failed to get business features');
  }

  return data || [];
}

/**
 * Check if a specific feature is enabled for a business
 */
export async function isFeatureEnabled(businessId: string, featureKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('tenant_features')
    .select('is_enabled')
    .eq('business_id', businessId)
    .eq('feature_key', featureKey)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned
    logger.error('Failed to check feature status', { error, businessId, featureKey });
    throw new Error('Failed to check feature status');
  }

  if (!data) {
    // Feature not set, check default
    const { data: defData } = await supabase
      .from('feature_definitions')
      .select('default_enabled')
      .eq('feature_key', featureKey)
      .single();

    return defData?.default_enabled ?? true;
  }

  return data.is_enabled;
}

/**
 * Update a single feature for a business
 */
export async function updateFeature(
  businessId: string,
  featureKey: string,
  isEnabled: boolean,
  adminId: string
): Promise<TenantFeature> {
  const now = new Date().toISOString();

  const updateData: Record<string, unknown> = {
    is_enabled: isEnabled,
    updated_at: now,
  };

  if (isEnabled) {
    updateData.enabled_at = now;
    updateData.enabled_by = adminId;
    updateData.disabled_at = null;
    updateData.disabled_by = null;
  } else {
    updateData.disabled_at = now;
    updateData.disabled_by = adminId;
    updateData.enabled_at = null;
    updateData.enabled_by = null;
  }

  const { data, error } = await supabase
    .from('tenant_features')
    .update(updateData)
    .eq('business_id', businessId)
    .eq('feature_key', featureKey)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update feature', { error, businessId, featureKey });
    throw new Error('Failed to update feature');
  }

  logger.info('Feature updated', {
    businessId,
    featureKey,
    isEnabled,
    adminId,
  });

  return data;
}

/**
 * Bulk update multiple features for a business
 */
export async function bulkUpdateFeatures(
  businessId: string,
  features: FeatureUpdate[],
  adminId: string
): Promise<TenantFeature[]> {
  const results: TenantFeature[] = [];
  const now = new Date().toISOString();

  for (const feature of features) {
    const updateData: Record<string, unknown> = {
      is_enabled: feature.is_enabled,
      updated_at: now,
    };

    if (feature.is_enabled) {
      updateData.enabled_at = now;
      updateData.enabled_by = adminId;
      updateData.disabled_at = null;
      updateData.disabled_by = null;
    } else {
      updateData.disabled_at = now;
      updateData.disabled_by = adminId;
      updateData.enabled_at = null;
      updateData.enabled_by = null;
    }

    const { data, error } = await supabase
      .from('tenant_features')
      .update(updateData)
      .eq('business_id', businessId)
      .eq('feature_key', feature.feature_key)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update feature in bulk', {
        error,
        businessId,
        featureKey: feature.feature_key,
      });
      continue;
    }

    results.push(data);
  }

  logger.info('Bulk features updated', {
    businessId,
    count: results.length,
    adminId,
  });

  return results;
}

/**
 * Initialize features for a business (called when business is created)
 * This is also handled by database trigger, but can be called manually
 */
export async function initializeBusinessFeatures(businessId: string): Promise<void> {
  const { error } = await supabase.rpc('initialize_business_features', {
    p_business_id: businessId,
  });

  if (error) {
    logger.error('Failed to initialize business features', { error, businessId });
    throw new Error('Failed to initialize business features');
  }

  logger.info('Business features initialized', { businessId });
}

/**
 * Get features with definitions for display
 */
export async function getBusinessFeaturesWithDefinitions(businessId: string): Promise<
  Array<{
    feature_key: string;
    display_name: string;
    description: string;
    category: string;
    is_enabled: boolean;
    default_enabled: boolean;
  }>
> {
  const [definitions, features] = await Promise.all([
    getAllFeatureDefinitions(),
    getBusinessFeatures(businessId),
  ]);

  const featureMap = new Map(features.map((f) => [f.feature_key, f.is_enabled]));

  return definitions.map((def) => ({
    feature_key: def.feature_key,
    display_name: def.display_name,
    description: def.description,
    category: def.category,
    is_enabled: featureMap.get(def.feature_key) ?? def.default_enabled,
    default_enabled: def.default_enabled,
  }));
}
