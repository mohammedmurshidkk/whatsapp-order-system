import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { Business, MenuItem, MenuCategory, BusinessOutlet, Session } from '../types';
import { getCachedMenu, setCachedMenu } from './cacheService';

// Stop words for English and Malayalam
const STOP_WORDS = new Set([
  // English
  'i', 'me', 'my', 'want', 'need', 'can', 'get', 'have', 'the', 'a', 'an', 'to', 'for',
  'of', 'and', 'or', 'is', 'it', 'in', 'on', 'at', 'by', 'with', 'from', 'this', 'that',
  'please', 'pls', 'plz', 'give', 'some', 'one', 'two', 'would', 'like', 'do', 'you',
  'your', 'just', 'also', 'too', 'any', 'will', 'be', 'are', 'was', 'were', 'been',
  // Malayalam transliterated
  'oru', 'enik', 'veno', 'taa', 'kodukk', 'thaa', 'venam', 'ente', 'enikku', 'ath',
  'ithu', 'athu', 'onnu', 'randu', 'moonu', 'naalu', 'anchu', 'aaru', 'ethra',
]);

export interface SmartContext {
  business?: Business;
  menuItems?: MenuItem[];
  menuCategories?: MenuCategory[];
  currentSessionItems?: string[];
  outlets?: BusinessOutlet[];
  sessionHasFulfillmentType?: boolean;
  sessionHasDeliveryInfo?: boolean;
  sessionHasPickupInfo?: boolean;
  amenities?: any[];
  customerLanguage?: 'en' | 'ml';
  activeOrder?: any;
  // Metadata
  contextType: 'minimal' | 'menu_search' | 'full';
  keywords?: string[];
}

export function extractKeywords(message: string): string[] {
  // Remove punctuation, normalize spaces
  const cleaned = message
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Split into words, filter stop words and short words
  const words = cleaned.split(' ').filter(word =>
    word.length > 2 && !STOP_WORDS.has(word)
  );

  // Remove duplicates
  return [...new Set(words)];
}

export async function searchMenuItems(
  businessId: string,
  keywords: string[]
): Promise<MenuItem[]> {
  if (!keywords.length) return [];

  try {
    // Build OR conditions for ILIKE search
    const orConditions = keywords.map(k => `name.ilike.%${k}%`).join(',');

    const { data, error } = await supabase
      .from('menu_items')
      .select(`
        id, name, base_price, sizes_with_prices, is_available,
        category_id, description, is_customizable,
        category:menu_categories(id, name)
      `)
      .eq('business_id', businessId)
      .eq('is_available', true)
      .or(orConditions)
      .limit(10);

    if (error) {
      logger.debug('Menu search error', { error });
      return [];
    }

    return data || [];
  } catch (error) {
    logger.debug('Menu search failed', { error });
    return [];
  }
}

export async function getCategoryList(businessId: string): Promise<MenuCategory[]> {
  try {
    const { data, error } = await supabase
      .from('menu_categories')
      .select('id, name, display_order')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order');

    if (error) {
      logger.debug('Category fetch error', { error });
      return [];
    }

    return data || [];
  } catch (error) {
    logger.debug('Category fetch failed', { error });
    return [];
  }
}

export async function getOutletsForContext(businessId: string): Promise<BusinessOutlet[]> {
  try {
    const { data, error } = await supabase
      .from('business_outlets')
      .select('id, name, address, opening_time, closing_time, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true);

    if (error) return [];
    return data || [];
  } catch (error) {
    return [];
  }
}

export async function getAmenitiesForContext(businessId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('business_amenities')
      .select('id, name, description, pricing_info, is_available')
      .eq('business_id', businessId)
      .eq('is_available', true);

    if (error) return [];
    return data || [];
  } catch (error) {
    return [];
  }
}

interface BuildContextOptions {
  message: string;
  businessId: string;
  business: Business | null;
  session: Session | null;
  cartItems?: any[];
  language?: 'en' | 'ml';
  tier?: number;
  activeOrder?: any;
}

export async function buildSmartContext(options: BuildContextOptions): Promise<SmartContext> {
  const {
    message,
    businessId,
    business,
    session,
    cartItems = [],
    language = 'en',
    tier = 2,
    activeOrder,
  } = options;

  const keywords = extractKeywords(message);

  // Base context - always included
  const context: SmartContext = {
    business: business || undefined,
    currentSessionItems: formatCartForAI(cartItems),
    sessionHasFulfillmentType: !!session?.fulfillment_type,
    sessionHasDeliveryInfo: !!session?.delivery_address,
    sessionHasPickupInfo: !!session?.pickup_outlet_id,
    customerLanguage: language,
    contextType: 'minimal',
    keywords,
    activeOrder,
  };

  // Tier 3: Full context
  if (tier === 3) {
    context.contextType = 'full';

    // Load all menu items (check cache first)
    let menuItems = await getCachedMenu(businessId);
    if (!menuItems) {
      menuItems = await getFullMenu(businessId);
      if (menuItems) {
        await setCachedMenu(businessId, menuItems);
      }
    }
    context.menuItems = menuItems || [];
    context.menuCategories = await getCategoryList(businessId);

    // Always include outlets and amenities for tier 3
    context.outlets = await getOutletsForContext(businessId);
    context.amenities = await getAmenitiesForContext(businessId);

    return context;
  }

  // Tier 2: Smart context - only relevant items
  context.contextType = 'menu_search';

  // Search for matching menu items
  if (keywords.length > 0) {
    const matchingItems = await searchMenuItems(businessId, keywords);

    if (matchingItems.length > 0) {
      context.menuItems = matchingItems;
      logger.debug(`Smart context: found ${matchingItems.length} matching items for keywords: ${keywords.join(', ')}`);
    } else {
      // No matches - include category list as fallback
      context.menuCategories = await getCategoryList(businessId);
      logger.debug('Smart context: no item matches, using category list');
    }
  } else {
    // No keywords extracted - include category list
    context.menuCategories = await getCategoryList(businessId);
  }

  // Conditionally include outlets if delivery/location mentioned
  if (/\b(delivery|pickup|outlet|branch|location|address|collect|takeaway)\b/i.test(message)) {
    context.outlets = await getOutletsForContext(businessId);
  }

  // Conditionally include amenities if mentioned
  if (/\b(party|hall|event|room|amenity|facility|catering|venue|booking)\b/i.test(message)) {
    context.amenities = await getAmenitiesForContext(businessId);
  }

  return context;
}

async function getFullMenu(businessId: string): Promise<MenuItem[] | null> {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select(`
        id, name, base_price, sizes_with_prices, is_available,
        category_id, description, is_customizable, special_notes,
        category:menu_categories(id, name)
      `)
      .eq('business_id', businessId)
      .eq('is_available', true);

    if (error) return null;
    return data || [];
  } catch (error) {
    return null;
  }
}

function formatCartForAI(cartItems: any[]): string[] {
  if (!cartItems || cartItems.length === 0) return [];

  return cartItems.map(item => {
    let itemStr = `${item.name}`;
    if (item.size_or_weight) {
      itemStr += ` (${item.size_or_weight})`;
    }
    itemStr += ` x${item.quantity}`;
    if (item.custom_text) {
      itemStr += ` - "${item.custom_text}"`;
    }
    return itemStr;
  });
}

// Tier 1 handlers - direct DB responses without AI
export async function handleTier1Intent(
  intent: string,
  businessId: string,
  business: Business | null
): Promise<string | null> {
  switch (intent) {
    case 'business_hours': {
      const outlets = await getOutletsForContext(businessId);
      if (outlets.length === 0) {
        return business?.operating_hours || 'Please contact us for our operating hours.';
      }

      const hoursText = outlets
        .map(o => `${o.name}: ${o.opening_time || '9:00'} - ${o.closing_time || '21:00'}`)
        .join('\n');

      return `Our operating hours:\n${hoursText}`;
    }

    case 'location': {
      const outlets = await getOutletsForContext(businessId);
      if (outlets.length === 0) {
        return business?.address || 'Please contact us for our location details.';
      }

      const locationText = outlets
        .map(o => `${o.name}: ${o.address || 'Address not available'}`)
        .join('\n');

      return `Our locations:\n${locationText}`;
    }

    case 'delivery_info': {
      if (!business?.supports_delivery) {
        return 'We currently do not offer delivery. Please visit our outlet for pickup.';
      }

      const deliveryInfo = business.delivery_charge
        ? `Delivery is available with a charge of ₹${business.delivery_charge}.`
        : 'Free delivery is available!';

      const areaInfo = business.delivery_areas
        ? ` We deliver to: ${business.delivery_areas}.`
        : '';

      return deliveryInfo + areaInfo;
    }

    default:
      return null;
  }
}
