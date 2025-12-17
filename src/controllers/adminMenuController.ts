import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { clearMenuCache } from '../services/menuService';
import { logger } from '../utils/logger';

// Types for price handling
interface SizePrice {
  name: string;
  price: number;
}

// List all menu items (including unavailable ones for admin)
export async function listMenuItems(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { category } = req.query;

    let query = supabase
      .from('menu_items')
      .select(`
        *,
        category:menu_categories(id, name)
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category_id', category);
    }

    const { data: items, error } = await query;

    if (error) {
      throw error;
    }

    res.status(200).json({
      items: (items || []).map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category_id: item.category_id,
        category_name: (item.category as any)?.name || null,
        // Price info - either single price OR sizes array
        price: item.price,  // null if using sizes
        sizes: item.sizes,  // null if using single price
        // Computed field for UI: which pricing type is used
        pricing_type: item.sizes && item.sizes.length > 0 ? 'sizes' : 'single',
        image_url: item.image_url || null,
        is_available: item.is_available,
        created_at: item.created_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to list menu items', error);
    res.status(500).json({ error: 'Failed to fetch menu items' });
  }
}

// Get single menu item
export async function getMenuItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    const { data: item, error } = await supabase
      .from('menu_items')
      .select(`
        *,
        category:menu_categories(id, name)
      `)
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (error || !item) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    res.status(200).json({
      item: {
        ...item,
        category_name: (item.category as any)?.name || null,
        pricing_type: item.sizes && item.sizes.length > 0 ? 'sizes' : 'single',
      },
    });
  } catch (error) {
    logger.error('Failed to get menu item', error);
    res.status(500).json({ error: 'Failed to fetch menu item' });
  }
}

// Create menu item
// Pricing options:
// 1. Single price: { price: 80 }
// 2. Size-based:   { sizes: [{ name: "500g", price: 400 }, { name: "1kg", price: 750 }] }
export async function createMenuItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      description,
      category_id,
      price,
      sizes,
      is_available = true,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    // Validate pricing - must have either price OR sizes, not both
    if (price && sizes && sizes.length > 0) {
      res.status(400).json({
        error: 'Cannot have both price and sizes. Use price for single price items, or sizes for variable pricing.',
      });
      return;
    }

    if (!price && (!sizes || sizes.length === 0)) {
      res.status(400).json({
        error: 'Either price or sizes is required',
      });
      return;
    }

    // Validate sizes format if provided
    if (sizes && sizes.length > 0) {
      const validSizes = validateSizes(sizes);
      if (!validSizes.valid) {
        res.status(400).json({ error: validSizes.error });
        return;
      }
    }

    // If category_id provided, verify it belongs to this business
    if (category_id) {
      const { data: category } = await supabase
        .from('menu_categories')
        .select('id')
        .eq('id', category_id)
        .eq('business_id', businessId)
        .single();

      if (!category) {
        res.status(400).json({ error: 'Invalid category_id' });
        return;
      }
    }

    const { data: item, error } = await supabase
      .from('menu_items')
      .insert({
        business_id: businessId,
        name,
        description: description || null,
        category_id: category_id || null,
        price: sizes && sizes.length > 0 ? null : price,  // null if using sizes
        sizes: sizes && sizes.length > 0 ? sizes : null,  // null if using single price
        is_available,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Menu item created: ${name}`);

    res.status(201).json({
      item: {
        ...item,
        pricing_type: item.sizes && item.sizes.length > 0 ? 'sizes' : 'single',
      },
    });
  } catch (error) {
    logger.error('Failed to create menu item', error);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
}

// Update menu item
// For price updates:
// - To change single price: { price: 100 }
// - To change to sizes: { price: null, sizes: [{name: "S", price: 50}, {name: "M", price: 80}] }
// - To update specific size: { sizes: [...all sizes with updated values...] }
// - To change to single price: { price: 100, sizes: null }
export async function updateMenuItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;
    const {
      name,
      description,
      category_id,
      price,
      sizes,
      is_available,
    } = req.body;

    // Verify item belongs to this business
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id, price, sizes')
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    // Validate sizes format if provided
    if (sizes !== undefined && sizes !== null && sizes.length > 0) {
      const validSizes = validateSizes(sizes);
      if (!validSizes.valid) {
        res.status(400).json({ error: validSizes.error });
        return;
      }
    }

    // If category_id provided, verify it belongs to this business
    if (category_id) {
      const { data: category } = await supabase
        .from('menu_categories')
        .select('id')
        .eq('id', category_id)
        .eq('business_id', businessId)
        .single();

      if (!category) {
        res.status(400).json({ error: 'Invalid category_id' });
        return;
      }
    }

    // Build update object with only provided fields
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category_id !== undefined) updateData.category_id = category_id;
    if (is_available !== undefined) updateData.is_available = is_available;

    // Handle price/sizes update
    // If sizes provided with values, clear price and set sizes
    if (sizes !== undefined) {
      if (sizes && sizes.length > 0) {
        updateData.sizes = sizes;
        updateData.price = null;  // Clear single price when using sizes
      } else if (sizes === null || (Array.isArray(sizes) && sizes.length === 0)) {
        updateData.sizes = null;  // Clear sizes
      }
    }

    // If price provided, set it (and optionally clear sizes if switching pricing type)
    if (price !== undefined) {
      updateData.price = price;
      // If explicitly setting price and sizes wasn't updated, clear sizes
      if (sizes === undefined && price !== null) {
        updateData.sizes = null;
      }
    }

    const { data: item, error } = await supabase
      .from('menu_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Menu item updated: ${itemId}`);

    res.status(200).json({
      item: {
        ...item,
        pricing_type: item.sizes && item.sizes.length > 0 ? 'sizes' : 'single',
      },
    });
  } catch (error) {
    logger.error('Failed to update menu item', error);
    res.status(500).json({ error: 'Failed to update menu item' });
  }
}

// Delete menu item
export async function deleteMenuItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    // Verify item belongs to this business
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id')
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    const { error } = await supabase
      .from('menu_items')
      .delete()
      .eq('id', itemId);

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Menu item deleted: ${itemId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete menu item', error);
    res.status(500).json({ error: 'Failed to delete menu item' });
  }
}

// Toggle item availability
export async function toggleAvailability(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;
    const { is_available } = req.body;

    if (typeof is_available !== 'boolean') {
      res.status(400).json({ error: 'is_available must be a boolean' });
      return;
    }

    // Verify item belongs to this business
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id, name')
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    const { error } = await supabase
      .from('menu_items')
      .update({ is_available })
      .eq('id', itemId);

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Menu item ${existing.name} availability: ${is_available}`);

    res.status(200).json({ success: true, is_available });
  } catch (error) {
    logger.error('Failed to toggle availability', error);
    res.status(500).json({ error: 'Failed to toggle availability' });
  }
}

// Upload image for menu item
export async function uploadItemImage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;

    // Verify item belongs to this business
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id')
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({ error: 'No image file uploaded' });
      return;
    }

    // Upload to Supabase Storage
    const fileName = `${businessId}/${itemId}-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('menu-images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      logger.error('Failed to upload image to storage', uploadError);
      res.status(500).json({ error: 'Failed to upload image' });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('menu-images')
      .getPublicUrl(fileName);

    const imageUrl = urlData.publicUrl;

    // Update menu item with image URL
    await supabase
      .from('menu_items')
      .update({ image_url: imageUrl })
      .eq('id', itemId);

    logger.info(`Image uploaded for menu item: ${itemId}`);

    res.status(200).json({ image_url: imageUrl });
  } catch (error) {
    logger.error('Failed to upload item image', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
}

// Update only price (convenience endpoint)
export async function updateItemPrice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { itemId } = req.params;
    const { price, sizes } = req.body;

    // Must provide either price or sizes
    if (price === undefined && sizes === undefined) {
      res.status(400).json({ error: 'Either price or sizes is required' });
      return;
    }

    // Verify item belongs to this business
    const { data: existing } = await supabase
      .from('menu_items')
      .select('id, name')
      .eq('id', itemId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Menu item not found' });
      return;
    }

    // Validate sizes if provided
    if (sizes && sizes.length > 0) {
      const validSizes = validateSizes(sizes);
      if (!validSizes.valid) {
        res.status(400).json({ error: validSizes.error });
        return;
      }
    }

    const updateData: Record<string, any> = {};

    if (sizes && sizes.length > 0) {
      // Switching to or updating size-based pricing
      updateData.sizes = sizes;
      updateData.price = null;
    } else if (price !== undefined) {
      // Switching to or updating single price
      updateData.price = price;
      updateData.sizes = null;
    }

    const { data: item, error } = await supabase
      .from('menu_items')
      .update(updateData)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Clear menu cache
    clearMenuCache(businessId);

    logger.info(`Price updated for ${existing.name}`);

    res.status(200).json({
      item: {
        ...item,
        pricing_type: item.sizes && item.sizes.length > 0 ? 'sizes' : 'single',
      },
    });
  } catch (error) {
    logger.error('Failed to update item price', error);
    res.status(500).json({ error: 'Failed to update price' });
  }
}

// Helper function to validate sizes array
function validateSizes(sizes: any[]): { valid: boolean; error?: string } {
  if (!Array.isArray(sizes)) {
    return { valid: false, error: 'sizes must be an array' };
  }

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];

    if (!size.name || typeof size.name !== 'string') {
      return { valid: false, error: `sizes[${i}].name is required and must be a string` };
    }

    if (size.price === undefined || size.price === null || typeof size.price !== 'number') {
      return { valid: false, error: `sizes[${i}].price is required and must be a number` };
    }

    if (size.price < 0) {
      return { valid: false, error: `sizes[${i}].price cannot be negative` };
    }
  }

  return { valid: true };
}
