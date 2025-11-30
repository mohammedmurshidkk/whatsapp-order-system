import { supabase } from '../config/database';
import { Business, MenuCategory, MenuItem } from '../types';
import { logger } from '../utils/logger';

// Cache for menu data (refreshes every 5 minutes)
const menuCache: Map<string, { data: MenuItem[]; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getBusinessByPhone(phone: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('phone', phone)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    logger.debug(`Business not found for phone: ${phone}`);
    return null;
  }

  return data as Business;
}

export async function getBusinessById(businessId: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Business;
}

export async function getMenuCategories(businessId: string): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    logger.error('Failed to fetch menu categories', error);
    return [];
  }

  return (data || []) as MenuCategory[];
}

export async function getMenuItems(businessId: string): Promise<MenuItem[]> {
  // Check cache first
  const cached = menuCache.get(businessId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const { data, error } = await supabase
    .from('menu_items')
    .select(`
      *,
      category:menu_categories(*),
      add_ons:menu_item_add_ons(add_on:add_ons(id, name, price))
    `)
    .eq('business_id', businessId)
    .eq('is_available', true);

  if (error) {
    logger.error('Failed to fetch menu items', error);
    return [];
  }

  const items = (data || []) as MenuItem[];

  // Update cache
  menuCache.set(businessId, { data: items, timestamp: Date.now() });

  return items;
}

export async function getMenuItemsByCategory(
  businessId: string,
  categoryId: string
): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('business_id', businessId)
    .eq('category_id', categoryId)
    .eq('is_available', true);

  if (error) {
    logger.error('Failed to fetch menu items by category', error);
    return [];
  }

  return (data || []) as MenuItem[];
}

export async function searchMenuItem(
  businessId: string,
  searchTerm: string
): Promise<MenuItem | null> {
  const items = await getMenuItems(businessId);

  // Normalize search term
  const normalizedSearch = searchTerm.toLowerCase().trim();

  // Try exact match first
  let found = items.find(
    item => item.name.toLowerCase() === normalizedSearch
  );

  // Try partial match
  if (!found) {
    found = items.find(
      item => item.name.toLowerCase().includes(normalizedSearch) ||
              normalizedSearch.includes(item.name.toLowerCase())
    );
  }

  return found || null;
}

export function formatMenuForAI(items: MenuItem[], categories: MenuCategory[]): string {
  if (items.length === 0) {
    return 'No menu items available.';
  }

  let menuText = 'MENU:\n';

  // Group items by category
  const categoryMap = new Map<string, MenuItem[]>();
  const uncategorized: MenuItem[] = [];

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];
      existing.push(item);
      categoryMap.set(item.category_id, existing);
    } else {
      uncategorized.push(item);
    }
  }

  // Format each category
  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      menuText += `\n${category.name.toUpperCase()}:\n`;
      for (const item of categoryItems) {
        menuText += formatMenuItem(item);
      }
    }
  }

  // Add uncategorized items
  if (uncategorized.length > 0) {
    menuText += '\nOTHER:\n';
    for (const item of uncategorized) {
      menuText += formatMenuItem(item);
    }
  }

  return menuText;
}

function formatMenuItem(item: MenuItem): string {
  let text = `- ${item.name}`;

  if (item.sizes && item.sizes.length > 0) {
    const sizeText = item.sizes
      .map(s => `${s.name}: ₹${s.price}`)
      .join(', ');
    text += ` (${sizeText})`;
  } else if (item.price) {
    text += ` - ₹${item.price}`;
  }

  if (item.is_customizable) {
    text += ' [customizable]';
  }

  text += '\n';
  return text;
}

export function formatMenuForCustomer(
  items: MenuItem[],
  categories: MenuCategory[]
): string {
  if (items.length === 0) {
    return 'Our menu is being updated. Please check back soon!';
  }

  let menuText = '📋 *Our Menu*\n\n';

  // Group items by category
  const categoryMap = new Map<string, MenuItem[]>();

  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];
      existing.push(item);
      categoryMap.set(item.category_id, existing);
    }
  }

  // Format each category with emojis
  const categoryEmojis: Record<string, string> = {
    'Cakes': '🎂',
    'Hot Beverages': '☕',
    'Cold Beverages': '🧊',
    'Snacks': '🍔',
    'default': '📌'
  };

  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (categoryItems && categoryItems.length > 0) {
      const emoji = categoryEmojis[category.name] || categoryEmojis['default'];
      menuText += `${emoji} *${category.name}*\n`;

      for (const item of categoryItems) {
        menuText += `  • ${item.name}`;
        if (item.sizes && item.sizes.length > 0) {
          const prices = item.sizes.map(s => `₹${s.price}`).join('/');
          menuText += ` - ${prices}`;
        }
        menuText += '\n';
      }
      menuText += '\n';
    }
  }

  menuText += '_Just tell me what you would like to order!_';
  return menuText;
}

// Clear cache for a business (call when menu is updated)
export function clearMenuCache(businessId: string): void {
  menuCache.delete(businessId);
}
