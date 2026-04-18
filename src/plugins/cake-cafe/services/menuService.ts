import { supabase } from '@/config/database';
import { Business, MenuCategory, MenuItem } from '@/types';
import { logger } from '@/utils/logger';

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
      category:menu_categories(*)
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

  // For large menus (50+ items), show only category overview
  if (items.length > 50) {
    let menuText = '📋 *Our Menu*\n\n';
    menuText += 'We have a wide selection! Here are our categories:\n\n';

    const categoryEmojis: Record<string, string> = {
      'Cakes': '🎂',
      'Hot Beverages': '☕',
      'Cold Beverages': '🧊',
      'Snacks': '🍔',
      'Beverages': '🥤',
      'Desserts': '🍰',
      'default': '📌'
    };

    for (const category of categories) {
      const emoji = categoryEmojis[category.name] || categoryEmojis['default'];
      menuText += `${emoji} *${category.name}*\n`;
      if (category.description) {
        menuText += `   ${category.description}\n`;
      }
    }

    menuText += '\n_Just tell me what you would like (e.g., "I want black forest cake") and I\'ll help you!_';
    return menuText;
  }

  // For smaller menus, show full details
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
    'Beverages': '🥤',
    'Desserts': '🍰',
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
        } else if (item.price) {
          menuText += ` - ₹${item.price}`;
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

// ============================================
// SMART GROUPING FOR INTERACTIVE LISTS
// ============================================

// Smart category groupings (MVP - hardcoded, will be replaced by database super categories)
const SMART_GROUPS: { name: string; emoji: string; categories: string[] }[] = [
  {
    name: 'Food',
    emoji: '🍔',
    categories: ['Appetizer', 'Burger', 'Sandwiches', 'Loaded Fries', 'Wrap', 'Pasta', 'Chicken Tender']
  },
  {
    name: 'Drinks',
    emoji: '☕',
    categories: ['Hot Drinks', 'Lemonade', 'Fresh Fruit Blend', 'Mojito', 'Milkshake']
  },
  {
    name: 'Frozen Treats',
    emoji: '🍨',
    categories: ['Falooda', 'Ice Cream Special', 'Sundaes', 'Kunafa']
  },
  {
    name: 'Cakes & Desserts',
    emoji: '🎂',
    categories: ['Cakes', 'Cheese Cake', 'Pastry Desserts', 'Premium Cakes', 'Mousse Cake']
  }
];

/**
 * Build interactive list for SUPER GROUPS (first level)
 * Shows 4 main groups: Food, Drinks, Frozen, Cakes
 * WhatsApp limit: 10 rows TOTAL across all sections
 */
export function buildSuperGroupList(
  categories: MenuCategory[]
): { title: string; rows: { id: string; title: string; description?: string }[] }[] {
  const rows: { id: string; title: string; description?: string }[] = [];

  for (const group of SMART_GROUPS) {
    // Count how many categories exist in this group
    const matchingCategories = group.categories.filter(catName =>
      categories.some(c => c.name.toLowerCase() === catName.toLowerCase())
    );

    if (matchingCategories.length > 0) {
      rows.push({
        id: `group:${group.name}`,
        title: `${group.emoji} ${group.name}`.substring(0, 24),
        description: `${matchingCategories.length} categories`,
      });
    }
  }

  // Check for uncategorized
  const usedCatNames = new Set(SMART_GROUPS.flatMap(g => g.categories.map(c => c.toLowerCase())));
  const uncategorized = categories.filter(c => !usedCatNames.has(c.name.toLowerCase()));
  if (uncategorized.length > 0 && rows.length < 10) {
    rows.push({
      id: 'group:More',
      title: 'More',
      description: `${uncategorized.length} more categories`,
    });
  }

  return [{
    title: 'Browse Menu',
    rows: rows.slice(0, 10) // WhatsApp max 10 rows total
  }];
}

/**
 * Build interactive list for categories within a super group (second level)
 * Shows categories in the selected group
 */
export function buildCategoriesInGroup(
  groupName: string,
  categories: MenuCategory[]
): { title: string; rows: { id: string; title: string; description?: string }[] }[] {
  const group = SMART_GROUPS.find(g => g.name.toLowerCase() === groupName.toLowerCase());

  if (groupName.toLowerCase() === 'more') {
    // Show uncategorized
    const usedCatNames = new Set(SMART_GROUPS.flatMap(g => g.categories.map(c => c.toLowerCase())));
    const uncategorized = categories.filter(c => !usedCatNames.has(c.name.toLowerCase()));

    return [{
      title: 'More Categories',
      rows: uncategorized.slice(0, 10).map(c => ({
        id: `cat:${c.id}`,
        title: c.name.substring(0, 24),
      }))
    }];
  }

  if (!group) {
    return [];
  }

  const rows: { id: string; title: string; description?: string }[] = [];

  for (const catName of group.categories) {
    const category = categories.find(
      c => c.name.toLowerCase() === catName.toLowerCase()
    );
    if (category && category.name) {
      rows.push({
        id: `cat:${category.id}`,
        title: category.name.substring(0, 24),
      });
    }
  }

  return [{
    title: `${group.emoji} ${group.name}`.substring(0, 24),
    rows: rows.slice(0, 10) // WhatsApp max 10 rows total
  }];
}

// Legacy function - keeping for backwards compatibility
export function buildCategoryListSections(
  categories: MenuCategory[]
): { title: string; rows: { id: string; title: string; description?: string }[] }[] {
  // Now redirects to super group list
  return buildSuperGroupList(categories);
}

/**
 * Build interactive list sections for items within a category
 * Handles pagination if category has more than 10 items
 */
export function buildItemListSections(
  items: MenuItem[],
  categoryName: string,
  page: number = 0
): {
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  hasMore: boolean;
  totalItems: number;
} {
  const ITEMS_PER_PAGE = 10;
  const startIndex = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const hasMore = items.length > startIndex + ITEMS_PER_PAGE;

  const rows = pageItems.map(item => {
    const row: { id: string; title: string; description?: string } = {
      id: `item:${item.id}`,
      title: (item.name || 'Item').substring(0, 24),
    };
    const priceDesc = formatItemPriceForList(item);
    if (priceDesc) {
      row.description = priceDesc;
    }
    return row;
  });

  return {
    sections: [{
      title: (categoryName || 'Menu').substring(0, 24),
      rows
    }],
    hasMore,
    totalItems: items.length
  };
}

/**
 * Format item price/sizes for list description (max 72 chars)
 */
function formatItemPriceForList(item: MenuItem): string {
  if (item.sizes && item.sizes.length > 0) {
    // Show sizes with prices
    const sizeTexts = item.sizes.map(s => `${s.name} ₹${s.price}`);
    const combined = sizeTexts.join(' | ');
    return combined.length <= 72 ? combined : sizeTexts.slice(0, 2).join(' | ');
  } else if (item.price) {
    return `₹${item.price}`;
  }
  return '';
}

/**
 * Build size selection buttons for an item
 * Returns buttons for reply message (max 3 buttons)
 */
export function buildSizeButtons(
  item: MenuItem
): { id: string; title: string }[] {
  if (!item.sizes || item.sizes.length === 0) {
    return [];
  }

  // WhatsApp allows max 3 buttons, button title max 20 chars
  return item.sizes.slice(0, 3).map(size => ({
    id: `size:${item.id}:${size.name}`,
    title: `${size.name} - ₹${size.price}`.substring(0, 20)
  }));
}

/**
 * Get category by ID
 */
export async function getCategoryById(categoryId: string): Promise<MenuCategory | null> {
  const { data, error } = await supabase
    .from('menu_categories')
    .select('*')
    .eq('id', categoryId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as MenuCategory;
}

/**
 * Get menu item by ID
 */
export async function getMenuItemById(itemId: string): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, category:menu_categories(*)')
    .eq('id', itemId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as MenuItem;
}

/**
 * Get menu item by retailer_id (SKU) for WhatsApp Catalog orders
 */
export async function getMenuItemByRetailerId(
  businessId: string,
  retailerId: string
): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*, category:menu_categories(*)')
    .eq('business_id', businessId)
    .eq('retailer_id', retailerId)
    .single();

  if (error || !data) {
    logger.debug(`Menu item not found for retailer_id: ${retailerId}`, { businessId });
    return null;
  }

  return data as MenuItem;
}
