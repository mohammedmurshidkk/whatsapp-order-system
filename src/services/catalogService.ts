/**
 * WhatsApp Catalog Service
 * Manages syncing menu items to Meta Commerce Catalog
 */

import axios from 'axios';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { getMetaCredentials } from './whatsappConnectionService';
import { MenuItem, CatalogSyncResult, CatalogItemStatus, CatalogSyncStatus } from '../types';
import { WHATSAPP_API_VERSION } from '../config/constants';

const META_GRAPH_API = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// Cache for business catalog settings (5 min TTL)
const catalogSettingsCache = new Map<string, { settings: CatalogSettings; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CatalogSettings {
  catalogId: string | null;
  commerceAccountId: string | null;
  catalogAccessToken: string | null;
}

interface MetaCatalogProduct {
  retailer_id: string;
  name: string;
  description?: string;
  price: number; // In smallest currency unit (paise)
  currency: string;
  availability: 'in stock' | 'out of stock';
  image_url?: string;
}

/**
 * Get catalog settings for a business
 */
export async function getCatalogSettings(businessId: string): Promise<CatalogSettings | null> {
  // Check cache
  const cached = catalogSettingsCache.get(businessId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.settings;
  }

  
  try {
    const { data: business, error } = await supabase
    .from('businesses')
    .select('meta_catalog_id, meta_commerce_account_id, meta_catalog_access_token')
    .eq('id', businessId)
    .single();

    console.log('############ businessId -> businessId', businessId, business, error)

    if (error || !business) {
      logger.warn('Business not found for catalog settings', { businessId });
      return null;
    }

    const settings: CatalogSettings = {
      catalogId: business.meta_catalog_id,
      commerceAccountId: business.meta_commerce_account_id,
      catalogAccessToken: business.meta_catalog_access_token,
    };

    // Cache the result
    catalogSettingsCache.set(businessId, {
      settings,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return settings;
  } catch (error) {
    logger.error('Error fetching catalog settings', { businessId, error });
    return null;
  }
}

/**
 * Update catalog settings for a business
 */
export async function updateCatalogSettings(
  businessId: string,
  catalogId: string | null,
  commerceAccountId: string | null,
  catalogAccessToken?: string | null
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = {
      meta_catalog_id: catalogId,
      meta_commerce_account_id: commerceAccountId,
      updated_at: new Date().toISOString(),
    };

    // Only update token if explicitly provided (undefined means don't change)
    if (catalogAccessToken !== undefined) {
      updateData.meta_catalog_access_token = catalogAccessToken;
    }

    const { error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', businessId);

    if (error) {
      logger.error('Failed to update catalog settings', { businessId, error });
      return false;
    }

    // Clear cache
    catalogSettingsCache.delete(businessId);
    return true;
  } catch (error) {
    logger.error('Error updating catalog settings', { businessId, error });
    return false;
  }
}

/**
 * Generate a unique retailer_id (SKU) for a menu item
 * Format: {BUSINESS_PREFIX}-{ITEM_SLUG}-{COUNTER}
 */
export async function generateRetailerId(businessId: string, itemName: string): Promise<string> {
  try {
    // Get business prefix
    const { data: business } = await supabase
      .from('businesses')
      .select('order_number_prefix, name')
      .eq('id', businessId)
      .single();

    // Use order prefix or first 3 chars of business name
    const prefix = business?.order_number_prefix ||
      (business?.name?.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'ITM');

    // Create slug from item name
    const slug = itemName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 20);

    // Find highest existing counter for this prefix-slug combination
    const { data: existing } = await supabase
      .from('menu_items')
      .select('retailer_id')
      .eq('business_id', businessId)
      .ilike('retailer_id', `${prefix}-${slug}-%`);

    let counter = 1;
    if (existing && existing.length > 0) {
      const counters = existing
        .map(item => {
          const match = item.retailer_id?.match(/-(\d+)$/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => !isNaN(n));

      if (counters.length > 0) {
        counter = Math.max(...counters) + 1;
      }
    }

    return `${prefix}-${slug}-${String(counter).padStart(3, '0')}`;
  } catch (error) {
    logger.error('Error generating retailer_id', { businessId, itemName, error });
    // Fallback to UUID-based SKU
    return `SKU-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }
}

/**
 * Convert menu item to Meta Catalog product format
 * Uses the /items_batch API format
 */
function toMetaCatalogProduct(item: MenuItem, currency: string, businessName: string): Record<string, string> {
  // Get base price (use first size if available, otherwise use item price)
  const price = item.sizes && item.sizes.length > 0
    ? Math.min(...item.sizes.map(s => s.price))
    : (item.price || 0);

  return {
    id: item.retailer_id!,
    title: item.name,
    description: item.description || item.name,
    price: `${price} ${currency.toUpperCase()}`, // Format: "100 INR"
    availability: item.is_available ? 'in stock' : 'out of stock',
    condition: 'new',
    brand: businessName,
    link: `https://wa.me/?text=Order%20${encodeURIComponent(item.name)}`, // Placeholder link
    image_link: item.image_url || 'https://placehold.co/400x400?text=No+Image',
  };
}

/**
 * Sync a single product to Meta Catalog
 */
export async function syncProductToCatalog(
  businessId: string,
  menuItem: MenuItem
): Promise<{ retailer_id: string; success: boolean; error?: string }> {
  try {
    // Get catalog settings
    const settings = await getCatalogSettings(businessId);
    if (!settings?.catalogId) {
      return { retailer_id: '', success: false, error: 'Catalog ID not configured' };
    }

    // Generate retailer_id if not exists
    let retailerId = menuItem.retailer_id;
    if (!retailerId) {
      retailerId = await generateRetailerId(businessId, menuItem.name);

      // Save retailer_id to database
      await supabase
        .from('menu_items')
        .update({ retailer_id: retailerId })
        .eq('id', menuItem.id);

      menuItem.retailer_id = retailerId;
    }

    // Get business currency and name
    const { data: business } = await supabase
      .from('businesses')
      .select('currency, name, meta_catalog_access_token')
      .eq('id', businessId)
      .single();
    const currency = business?.currency || 'INR';
    const businessName = business?.name || 'Store';

    // Use catalog-specific access token if available, otherwise fall back to WhatsApp token
    let accessToken = business?.meta_catalog_access_token;
    if (!accessToken) {
      const credentials = await getMetaCredentials(businessId);
      if (!credentials?.accessToken) {
        return { retailer_id: menuItem.retailer_id || '', success: false, error: 'No access token configured. Please set a Catalog Access Token in settings.' };
      }
      accessToken = credentials.accessToken;
    }

    // Convert to Meta format
    const product = toMetaCatalogProduct(menuItem, currency, businessName);

    // Build request payload for items_batch API
    const requestData = [{
      method: 'UPDATE',
      data: product,
    }];

    // Call Meta Commerce API - items_batch endpoint with form-urlencoded data
    const formData = new URLSearchParams();
    formData.append('item_type', 'PRODUCT_ITEM');
    formData.append('requests', JSON.stringify(requestData));

    const response = await axios.post(
      `${META_GRAPH_API}/${settings.catalogId}/items_batch`,
      formData.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // Update sync status in database
    await updateItemSyncStatus(menuItem.id, 'synced', retailerId);

    logger.info('Product synced to catalog', {
      businessId,
      itemId: menuItem.id,
      retailerId,
      response: response.data
    });

    return { retailer_id: retailerId, success: true };
  } catch (error) {
    logger.error('Failed to sync product to catalog', {
      businessId,
      itemId: menuItem.id,
      error: axios.isAxiosError(error) ? error.response?.data : error
    });

    // Update sync status to failed
    await updateItemSyncStatus(menuItem.id, 'failed');

    const errorMessage = axios.isAxiosError(error)
      ? error.response?.data?.error?.message || error.message
      : 'Unknown error';

    return {
      retailer_id: menuItem.retailer_id || '',
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Sync selected products to Meta Catalog
 * @param itemIds - Array of item IDs to sync. If empty, syncs all available items.
 */
export async function syncProductsToCatalog(
  businessId: string,
  itemIds?: string[]
): Promise<CatalogSyncResult> {
  const result: CatalogSyncResult = {
    success: true,
    synced_count: 0,
    failed_count: 0,
    errors: [],
  };

  try {
    // Build query
    let query = supabase
      .from('menu_items')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_available', true);

    // If specific items requested, filter by IDs
    if (itemIds && itemIds.length > 0) {
      query = query.in('id', itemIds);
    }

    const { data: items, error } = await query;

    if (error || !items) {
      logger.error('Failed to fetch menu items for catalog sync', { businessId, error });
      return { ...result, success: false };
    }

    // Sync each item
    for (const item of items) {
      const syncResult = await syncProductToCatalog(businessId, item as MenuItem);

      if (syncResult.success) {
        result.synced_count++;
      } else {
        result.failed_count++;
        result.errors?.push({
          item_id: item.id,
          error: syncResult.error || 'Unknown error',
        });
      }
    }

    result.success = result.failed_count === 0;

    logger.info('Catalog sync completed', {
      businessId,
      synced: result.synced_count,
      failed: result.failed_count,
      totalRequested: itemIds?.length || 'all'
    });

    return result;
  } catch (error) {
    logger.error('Catalog sync failed', { businessId, error });
    return { ...result, success: false };
  }
}

/**
 * Sync all products for a business to Meta Catalog (legacy wrapper)
 */
export async function syncAllProductsToCatalog(businessId: string): Promise<CatalogSyncResult> {
  return syncProductsToCatalog(businessId);
}

/**
 * Remove a product from Meta Catalog
 */
export async function removeProductFromCatalog(
  businessId: string,
  itemId: string
): Promise<boolean> {
  try {
    // Get the item to find retailer_id
    const { data: item } = await supabase
      .from('menu_items')
      .select('retailer_id')
      .eq('id', itemId)
      .single();

    if (!item?.retailer_id) {
      logger.warn('Item has no retailer_id, cannot remove from catalog', { itemId });
      return true; // Nothing to remove
    }

    const settings = await getCatalogSettings(businessId);
    if (!settings?.catalogId) {
      return false;
    }

    const credentials = await getMetaCredentials(businessId);
    if (!credentials?.accessToken) {
      return false;
    }

    // Call Meta Commerce API to delete
    await axios.post(
      `${META_GRAPH_API}/${settings.catalogId}/products`,
      {
        requests: [{
          method: 'DELETE',
          retailer_id: item.retailer_id,
        }],
      },
      {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update database
    await supabase
      .from('menu_items')
      .update({
        catalog_sync_status: 'not_synced',
        catalog_synced_at: null,
      })
      .eq('id', itemId);

    logger.info('Product removed from catalog', { businessId, itemId, retailerId: item.retailer_id });
    return true;
  } catch (error) {
    logger.error('Failed to remove product from catalog', { businessId, itemId, error });
    return false;
  }
}

/**
 * Get catalog sync status for all items
 */
export async function getCatalogSyncStatus(businessId: string): Promise<CatalogItemStatus[]> {
  try {
    const { data: items, error } = await supabase
      .from('menu_items')
      .select('id, retailer_id, catalog_sync_status, catalog_synced_at')
      .eq('business_id', businessId);

    if (error || !items) {
      return [];
    }

    return items.map(item => ({
      item_id: item.id,
      retailer_id: item.retailer_id,
      sync_status: (item.catalog_sync_status || 'not_synced') as CatalogSyncStatus,
      synced_at: item.catalog_synced_at,
    }));
  } catch (error) {
    logger.error('Failed to get catalog sync status', { businessId, error });
    return [];
  }
}

/**
 * Update item sync status in database
 */
async function updateItemSyncStatus(
  itemId: string,
  status: CatalogSyncStatus,
  retailerId?: string
): Promise<void> {
  try {
    const updateData: Record<string, unknown> = {
      catalog_sync_status: status,
    };

    if (status === 'synced') {
      updateData.catalog_synced_at = new Date().toISOString();
    }

    if (retailerId) {
      updateData.retailer_id = retailerId;
    }

    await supabase
      .from('menu_items')
      .update(updateData)
      .eq('id', itemId);
  } catch (error) {
    logger.error('Failed to update item sync status', { itemId, status, error });
  }
}

/**
 * Test catalog connection
 */
export async function testCatalogConnection(businessId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = await getCatalogSettings(businessId);
    console.log('###### settings', settings, businessId)
    if (!settings?.catalogId) {
      return { success: false, error: 'Catalog ID not configured' };
    }

    // Use catalog-specific access token if available
    let accessToken = settings.catalogAccessToken;

    // Fall back to WhatsApp token if no catalog token
    if (!accessToken) {
      const credentials = await getMetaCredentials(businessId);
      if (!credentials?.accessToken) {
        return { success: false, error: 'Access token not configured' };
      }
      accessToken = credentials.accessToken;
    }

    // Try to fetch catalog info
    const response = await axios.get(
      `${META_GRAPH_API}/${settings.catalogId}`,
      {
        params: { fields: 'id,name,product_count' },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    logger.info('Catalog connection test successful', { businessId, catalog: response.data });
    return { success: true };
  } catch (error) {
    const errorMessage = axios.isAxiosError(error)
      ? error.response?.data?.error?.message || error.message
      : 'Connection failed';

    logger.error('Catalog connection test failed', { businessId, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

// Clear cache (for updates)
export function clearCatalogSettingsCache(businessId?: string): void {
  if (businessId) {
    catalogSettingsCache.delete(businessId);
  } else {
    catalogSettingsCache.clear();
  }
}
