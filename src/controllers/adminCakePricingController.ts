import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import {
  getFlavorPricings,
  getFlavorPricingById,
  createFlavorPricing,
  updateFlavorPricing,
  deleteFlavorPricing,
  getDesignElements,
  createDesignElement,
  updateDesignElement,
  deleteDesignElement,
  seedStandardDesignElements,
  getFullPricingConfig,
} from '../services/cakePricingService';
import {
  importFlavorsFromCSV,
  exportFlavorsToCSV,
} from '../services/flavorImportService';
import { CakeDesignPriceType, CakeFlavorSize } from '../types';

// ============================================
// WEIGHT PRICING
// ============================================

export async function listWeightPricings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    throw new Error('####### hi - 444  - -- - ')
    // const weights = await getWeightPricings(businessId);
    // res.status(200).json({ success: true, data: weights });
  } catch (error) {
    logger.error('Failed to list weight pricings', error);
    res.status(500).json({ error: 'Failed to fetch weight pricings' });
  }
}

export async function createWeight(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { weight_grams, base_price } = req.body;

    if (!weight_grams || weight_grams <= 0) {
      res.status(400).json({ error: 'weight_grams is required and must be positive' });
      return;
    }

    if (base_price === undefined || base_price < 0) {
      res.status(400).json({ error: 'base_price is required and must be non-negative' });
      return;
    }

    // const weight = await createWeightPricing(businessId, weight_grams, base_price);
    // logger.info(`Weight pricing created: ${weight_grams}g = ₹${base_price}`);
    // res.status(201).json({ success: true, data: weight });
  } catch (error) {
    logger.error('Failed to create weight pricing', error);
    res.status(500).json({ error: 'Failed to create weight pricing' });
  }
}

export async function updateWeight(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { weight_grams, base_price, is_active } = req.body;

    const updates: Record<string, unknown> = {};
    if (weight_grams !== undefined) updates.weight_grams = weight_grams;
    if (base_price !== undefined) updates.base_price = base_price;
    if (is_active !== undefined) updates.is_active = is_active;

    throw new Error('####### hi - 333  - -- - ')
    // const weight = await updateWeightPricing(id, updates);
    // logger.info(`Weight pricing updated: ${id}`);
    // res.status(200).json({ success: true, data: weight });
  } catch (error) {
    logger.error('Failed to update weight pricing', error);
    res.status(500).json({ error: 'Failed to update weight pricing' });
  }
}

export async function deleteWeight(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    // const success = await deleteWeightPricing(id);

    // if (!success) {
    //   res.status(404).json({ error: 'Weight pricing not found' });
    //   return;
    // }

    throw new Error('####### hi  - -- - ')

    logger.info(`Weight pricing deleted: ${id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete weight pricing', error);
    res.status(500).json({ error: 'Failed to delete weight pricing' });
  }
}

// ============================================
// FLAVOR PRICING
// ============================================

export async function listFlavorPricings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const flavors = await getFlavorPricings(businessId);
    res.status(200).json({ success: true, data: flavors });
  } catch (error) {
    logger.error('Failed to list flavor pricings', error);
    res.status(500).json({ error: 'Failed to fetch flavor pricings' });
  }
}

export async function createFlavor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { flavor_name, sizes } = req.body;

    if (!flavor_name) {
      res.status(400).json({ error: 'flavor_name is required' });
      return;
    }

    if (!sizes || !Array.isArray(sizes) || sizes.length === 0) {
      res.status(400).json({ error: 'sizes array is required with at least one size' });
      return;
    }

    // Validate each size
    for (const size of sizes) {
      if (!size.name || typeof size.name !== 'string') {
        res.status(400).json({ error: 'Each size must have a name (e.g., "500g", "1kg")' });
        return;
      }
      if (typeof size.price !== 'number' || size.price < 0) {
        res.status(400).json({ error: 'Each size must have a valid price' });
        return;
      }
    }

    const flavor = await createFlavorPricing(businessId, flavor_name, sizes as CakeFlavorSize[]);
    logger.info(`Flavor pricing created: ${flavor_name} with ${sizes.length} sizes`);
    res.status(201).json({ success: true, data: flavor });
  } catch (error) {
    logger.error('Failed to create flavor pricing', error);
    res.status(500).json({ error: 'Failed to create flavor pricing' });
  }
}

export async function updateFlavor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { flavor_name, sizes, is_active } = req.body;

    // Validate sizes if provided
    if (sizes !== undefined) {
      if (!Array.isArray(sizes) || sizes.length === 0) {
        res.status(400).json({ error: 'sizes must be an array with at least one size' });
        return;
      }
      for (const size of sizes) {
        if (!size.name || typeof size.name !== 'string') {
          res.status(400).json({ error: 'Each size must have a name (e.g., "500g", "1kg")' });
          return;
        }
        if (typeof size.price !== 'number' || size.price < 0) {
          res.status(400).json({ error: 'Each size must have a valid price' });
          return;
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (flavor_name !== undefined) updates.flavor_name = flavor_name;
    if (sizes !== undefined) updates.sizes = sizes as CakeFlavorSize[];
    if (is_active !== undefined) updates.is_active = is_active;

    const flavor = await updateFlavorPricing(id, updates);
    logger.info(`Flavor pricing updated: ${id}`);
    res.status(200).json({ success: true, data: flavor });
  } catch (error) {
    logger.error('Failed to update flavor pricing', error);
    res.status(500).json({ error: 'Failed to update flavor pricing' });
  }
}

export async function deleteFlavor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const success = await deleteFlavorPricing(id);

    if (!success) {
      res.status(404).json({ error: 'Flavor pricing not found' });
      return;
    }

    logger.info(`Flavor pricing deleted: ${id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete flavor pricing', error);
    res.status(500).json({ error: 'Failed to delete flavor pricing' });
  }
}

// ============================================
// DESIGN ELEMENTS
// ============================================

export async function listDesignElements(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const elements = await getDesignElements(businessId);
    res.status(200).json({ success: true, data: elements });
  } catch (error) {
    logger.error('Failed to list design elements', error);
    res.status(500).json({ error: 'Failed to fetch design elements' });
  }
}

export async function createElement(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { element_key, element_label, price, price_type = 'fixed' } = req.body;

    if (!element_key) {
      res.status(400).json({ error: 'element_key is required' });
      return;
    }

    if (!element_label) {
      res.status(400).json({ error: 'element_label is required' });
      return;
    }

    if (price === undefined || price < 0) {
      res.status(400).json({ error: 'price is required and must be non-negative' });
      return;
    }

    if (price_type !== 'fixed' && price_type !== 'per_unit') {
      res.status(400).json({ error: 'price_type must be "fixed" or "per_unit"' });
      return;
    }

    const element = await createDesignElement(
      businessId,
      element_key,
      element_label,
      price,
      price_type as CakeDesignPriceType
    );
    logger.info(`Design element created: ${element_key} = ₹${price}`);
    res.status(201).json({ success: true, data: element });
  } catch (error) {
    logger.error('Failed to create design element', error);
    res.status(500).json({ error: 'Failed to create design element' });
  }
}

export async function updateElement(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { element_key, element_label, price, price_type, is_active, sort_order } = req.body;

    const updates: Record<string, unknown> = {};
    if (element_key !== undefined) updates.element_key = element_key;
    if (element_label !== undefined) updates.element_label = element_label;
    if (price !== undefined) updates.price = price;
    if (price_type !== undefined) updates.price_type = price_type;
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const element = await updateDesignElement(id, updates);
    logger.info(`Design element updated: ${id}`);
    res.status(200).json({ success: true, data: element });
  } catch (error) {
    logger.error('Failed to update design element', error);
    res.status(500).json({ error: 'Failed to update design element' });
  }
}

export async function deleteElement(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const success = await deleteDesignElement(id);

    if (!success) {
      res.status(404).json({ error: 'Design element not found' });
      return;
    }

    logger.info(`Design element deleted: ${id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete design element', error);
    res.status(500).json({ error: 'Failed to delete design element' });
  }
}

// ============================================
// SEED STANDARD ELEMENTS
// ============================================

export async function seedElements(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await seedStandardDesignElements(businessId);
    // Return all elements after seeding
    const elements = await getDesignElements(businessId);
    res.status(200).json({ success: true, data: elements });
  } catch (error) {
    logger.error('Failed to seed design elements', error);
    res.status(500).json({ error: 'Failed to seed design elements' });
  }
}

// ============================================
// GET FULL CONFIG
// ============================================

export async function getFullConfig(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get business settings
    const { data: business } = await supabase
      .from('businesses')
      .select('custom_cake_enabled, custom_cake_auto_send, custom_cake_quote_expiry_hours')
      .eq('id', businessId)
      .single();

    // Get pricing config
    const config = await getFullPricingConfig(businessId);

    res.status(200).json({
      success: true,
      data: {
        enabled: business?.custom_cake_enabled ?? false,
        auto_send: business?.custom_cake_auto_send ?? false,
        quote_expiry_hours: business?.custom_cake_quote_expiry_hours ?? 24,
        weights: config.weights,
        flavors: config.flavors,
        elements: config.designElements, // Frontend expects 'elements' not 'designElements'
      },
    });
  } catch (error) {
    logger.error('Failed to get full pricing config', error);
    res.status(500).json({ error: 'Failed to fetch pricing config' });
  }
}

// ============================================
// UPDATE CONFIG (business settings)
// ============================================

export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { enabled, auto_send, quote_expiry_hours } = req.body;

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (enabled !== undefined) updates.custom_cake_enabled = enabled;
    if (auto_send !== undefined) updates.custom_cake_auto_send = auto_send;
    if (quote_expiry_hours !== undefined) updates.custom_cake_quote_expiry_hours = quote_expiry_hours;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data: business, error } = await supabase
      .from('businesses')
      .update(updates)
      .eq('id', businessId)
      .select('custom_cake_enabled, custom_cake_auto_send, custom_cake_quote_expiry_hours')
      .single();

    if (error) {
      throw error;
    }

    // Get full config to return
    const config = await getFullPricingConfig(businessId);

    logger.info(`Cake pricing config updated for business ${businessId}`);
    res.status(200).json({
      success: true,
      data: {
        enabled: business?.custom_cake_enabled ?? false,
        auto_send: business?.custom_cake_auto_send ?? false,
        quote_expiry_hours: business?.custom_cake_quote_expiry_hours ?? 24,
        weights: config.weights,
        flavors: config.flavors,
        elements: config.designElements,
      },
    });
  } catch (error) {
    logger.error('Failed to update pricing config', error);
    res.status(500).json({ error: 'Failed to update pricing config' });
  }
}

// ============================================
// FLAVOR CSV IMPORT / EXPORT
// ============================================

/**
 * Import flavors from CSV content passed in body
 */
export async function importFlavors(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { csv, replace } = req.body;

    if (!csv) {
      res.status(400).json({ error: 'CSV content is required in request body' });
      return;
    }

    const result = await importFlavorsFromCSV(businessId, csv, replace === true);

    if (result.success) {
      res.status(200).json({
        message: 'Flavors imported successfully',
        ...result,
      });
    } else {
      res.status(207).json({
        message: 'Flavors imported with some errors',
        ...result,
      });
    }
  } catch (error) {
    logger.error('Failed to import flavors', error);
    res.status(500).json({ error: 'Failed to import flavors' });
  }
}

/**
 * Import flavors from uploaded CSV file
 */
export async function importFlavorsFile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No CSV file uploaded. Use form field name "flavors"' });
      return;
    }

    const replace = req.query.replace === 'true';
    const csv = req.file.buffer.toString('utf-8');

    const result = await importFlavorsFromCSV(businessId, csv, replace);

    res.status(200).json({
      message: result.success ? 'Flavors imported successfully' : 'Flavors imported with errors',
      fileName: req.file.originalname,
      ...result,
    });
  } catch (error) {
    logger.error('Failed to upload flavors file', error);
    res.status(500).json({ error: 'Failed to import flavors' });
  }
}

/**
 * Export flavors to CSV
 */
export async function exportFlavors(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const csv = await exportFlavorsToCSV(businessId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=flavors_${businessId}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    logger.error('Failed to export flavors', error);
    res.status(500).json({ error: 'Failed to export flavors' });
  }
}

/**
 * Download blank flavor template
 */
export async function downloadFlavorTemplate(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const templatePath = path.join(__dirname, '../../templates/flavors_template.csv');

    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=flavors_template.csv');
      res.status(200).send(template);
    } else {
      const defaultTemplate = `flavor_name,sizes,is_active
Vanilla,500g:400:true|1kg:750:false,true
Chocolate Truffle,500g:450:true|1kg:850:false,true`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=flavors_template.csv');
      res.status(200).send(defaultTemplate);
    }
  } catch (error) {
    logger.error('Failed to send flavor template', error);
    res.status(500).json({ error: 'Failed to download flavor template' });
  }
}
