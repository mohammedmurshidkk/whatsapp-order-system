import { supabase } from '../config/database';
import { logger } from '../utils/logger';

// TODO: Define these types properly in src/types/index.ts
type OrderItem = any;
type PopularityPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';

/**
 * Updates the order item statistics after an order is created.
 * @param businessId - The ID of the business.
 * @param orderItems - An array of items from the order.
 */
export async function updateItemStats(businessId: string, orderItems: OrderItem[]): Promise<void> {
  logger.info(`Updating item stats for business ${businessId}`);
  if (!orderItems || orderItems.length === 0) {
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  for (const item of orderItems) {
    // Assuming item has menu_item_id, quantity, and price
    const { menu_item_id, name, quantity, price } = item;
    if (!menu_item_id) continue;

    const { error } = await supabase.rpc('increment_item_stats', {
      p_business_id: businessId,
      p_menu_item_id: menu_item_id,
      p_item_name: name,
      p_quantity: quantity,
      p_revenue: price * quantity,
      p_date: today,
    });

    if (error) {
      logger.error(`Failed to increment stats for item ${name} (${menu_item_id})`, error);
    }
  }
}

/**
 * Retrieves the top-selling items for a given period with full menu item details.
 * @param businessId - The ID of the business.
 * @param period - The period to retrieve stats for ('daily', 'weekly', 'monthly', 'all_time').
 * @param limit - The maximum number of items to return.
 */
export async function getTopSellingItems(
  businessId: string,
  period: PopularityPeriod = 'weekly',
  limit: number = 10
): Promise<any[]> {
    const { data, error } = await supabase
    .from('order_item_stats')
    .select('*, menu_item:menu_items(id, name, description, price, sizes, image_url)')
    .eq('business_id', businessId)
    .eq('period_type', period)
    .order('order_count', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error(`Failed to get top selling items for period ${period}`, error);
    return [];
  }

  return data;
}

/**
 * Retrieves the manually featured items for a business.
 * @param businessId - The ID of the business.
 * @param limit - The maximum number of items to return.
 */
export async function getFeaturedItems(businessId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_featured', true)
    .order('featured_order', { ascending: true })
    .limit(limit);

    if (error) {
        logger.error('Failed to get featured items', error);
        return [];
    }

    return data;
}

/**
 * Merges and ranks featured and top-selling items for AI context.
 * Featured items are given a higher rank.
 * Returns normalized data with: item_name, description, base_price, sizes, image_url
 * @param businessId - The ID of the business.
 */
export async function getPopularItemsForAI(businessId: string): Promise<any[]> {
  const [featuredItems, topItems] = await Promise.all([
    getFeaturedItems(businessId, 5),
    getTopSellingItems(businessId, 'all_time', 10),
  ]);

  const combined = new Map<string, any>();

  // Add featured items with a high score boost (already have full menu item data)
  featuredItems.forEach(item => {
    combined.set(item.id, {
      id: item.id,
      item_name: item.name,
      description: item.description,
      base_price: item.price,
      sizes: item.sizes,
      image_url: item.image_url,
      score: 1000 + (item.featured_order || 0),
    });
  });

  // Add top selling items with joined menu_item data, avoiding duplicates
  topItems.forEach(item => {
    if (!combined.has(item.menu_item_id) && item.menu_item) {
      combined.set(item.menu_item_id, {
        id: item.menu_item_id,
        item_name: item.menu_item.name || item.item_name,
        description: item.menu_item.description,
        base_price: item.menu_item.price,
        sizes: item.menu_item.sizes,
        image_url: item.menu_item.image_url,
        score: item.order_count,
      });
    }
  });

  // Sort by score descending and take top 5
  const popularItems = Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  logger.info(`getPopularItemsForAI`, JSON.stringify({ popularItems, featuredItems, topItems }, null, 2));

  return popularItems;
}
