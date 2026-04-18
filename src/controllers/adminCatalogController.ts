import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  syncProductToCatalog,
  syncProductsToCatalog,
  removeProductFromCatalog,
  getCatalogSyncStatus,
  getCatalogSettings,
  updateCatalogSettings,
  testCatalogConnection,
  clearCatalogSettingsCache,
} from '../services/catalogService';
import { getMenuItemById } from '../plugins/cake-cafe/services/menuService';

/**
 * Sync menu items to Meta Commerce Catalog
 * Accepts optional `itemIds` array in body to sync specific items
 */
export async function syncToCatalog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemIds } = req.body as { itemIds?: string[] };

    logger.info('Starting catalog sync', {
      businessId,
      itemCount: itemIds?.length || 'all'
    });

    const result = await syncProductsToCatalog(businessId, itemIds);

    res.status(200).json({
      success: result.success,
      synced_count: result.synced_count,
      failed_count: result.failed_count,
      errors: result.errors,
      message: result.success
        ? `Successfully synced ${result.synced_count} items to catalog`
        : `Sync completed with ${result.failed_count} failures`,
    });
  } catch (error) {
    logger.error('Failed to sync catalog', error);
    res.status(500).json({ error: 'Failed to sync catalog' });
  }
}

/**
 * Sync a single menu item to Meta Commerce Catalog
 */
export async function syncItemToCatalog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    // Get the menu item
    const menuItem = await getMenuItemById(itemId);
    if (!menuItem) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    // Verify business ownership
    if (menuItem.business_id !== businessId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const result = await syncProductToCatalog(businessId, menuItem);

    if (result.success) {
      res.status(200).json({
        success: true,
        retailer_id: result.retailer_id,
        message: 'Item synced to catalog successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Failed to sync item to catalog', error);
    res.status(500).json({ error: 'Failed to sync item to catalog' });
  }
}

/**
 * Remove a menu item from Meta Commerce Catalog
 */
export async function removeFromCatalog(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    const success = await removeProductFromCatalog(businessId, itemId);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Item removed from catalog',
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to remove item from catalog',
      });
    }
  } catch (error) {
    logger.error('Failed to remove item from catalog', error);
    res.status(500).json({ error: 'Failed to remove item from catalog' });
  }
}

/**
 * Get catalog sync status for all menu items
 */
export async function getSyncStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await getCatalogSyncStatus(businessId);

    res.status(200).json({
      items: status,
    });
  } catch (error) {
    logger.error('Failed to get catalog sync status', error);
    res.status(500).json({ error: 'Failed to get catalog sync status' });
  }
}

/**
 * Get catalog settings for the business
 */
export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const settings = await getCatalogSettings(businessId);

    res.status(200).json({
      catalog_id: settings?.catalogId || null,
      commerce_account_id: settings?.commerceAccountId || null,
      has_catalog_access_token: !!settings?.catalogAccessToken,
    });
  } catch (error) {
    logger.error('Failed to get catalog settings', error);
    res.status(500).json({ error: 'Failed to get catalog settings' });
  }
}

/**
 * Update catalog settings for the business
 */
export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { catalog_id, commerce_account_id, catalog_access_token } = req.body;

    const success = await updateCatalogSettings(
      businessId,
      catalog_id || null,
      commerce_account_id || null,
      catalog_access_token // undefined means don't change, null clears it, string sets it
    );

    if (success) {
      // Clear cache
      clearCatalogSettingsCache(businessId);

      res.status(200).json({
        success: true,
        message: 'Catalog settings updated',
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to update catalog settings',
      });
    }
  } catch (error) {
    logger.error('Failed to update catalog settings', error);
    res.status(500).json({ error: 'Failed to update catalog settings' });
  }
}

/**
 * Test catalog connection
 */
export async function testConnection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await testCatalogConnection(businessId);

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Failed to test catalog connection', error);
    res.status(500).json({ error: 'Failed to test catalog connection' });
  }
}
