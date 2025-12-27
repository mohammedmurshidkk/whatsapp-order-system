import { Request, Response } from 'express';
import {
  importMenuFromCSV,
  exportMenuToCSV,
  validateMenuCSV,
} from '../services/menuImportService';
import { importAddonsFromCSV } from '../services/addonImportService';
import {
  getMenuItems,
  getMenuCategories,
  getBusinessById,
  formatMenuForCustomer,
  clearMenuCache,
} from '../services/menuService';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// PROTECTED ROUTES (JWT Auth - business from token)
// ============================================

// Get menu for authenticated business
export async function getMenu(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const items = await getMenuItems(businessId);
    const categories = await getMenuCategories(businessId);

    res.status(200).json({
      categories,
      items,
      formatted: formatMenuForCustomer(items, categories),
    });
  } catch (error) {
    logger.error('Failed to get menu', error);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
}

// Upload menu from CSV (JWT auth)
export async function uploadMenu(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await handleMenuUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload menu', error);
    res.status(500).json({ error: 'Failed to import menu' });
  }
}

// Upload CSV file (JWT auth)
export async function uploadMenuFile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await handleMenuFileUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload menu file', error);
    res.status(500).json({ error: 'Failed to import menu' });
  }
}

// Export menu (JWT auth)
export async function downloadMenu(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await handleMenuExport(businessId, res);
  } catch (error) {
    logger.error('Failed to export menu', error);
    res.status(500).json({ error: 'Failed to export menu' });
  }
}

// Import from file (JWT auth)
export async function importFromFile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await handleFileImport(businessId, req, res);
  } catch (error) {
    logger.error('Failed to import from file', error);
    res.status(500).json({ error: 'Failed to import menu from file' });
  }
}

// Upload addons (JWT auth)
export async function uploadAddons(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await handleAddonsUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload add-ons', error);
    res.status(500).json({ error: 'Failed to import add-ons' });
  }
}

// ============================================
// SUPER ADMIN ROUTES (businessId in URL params)
// ============================================

// Get menu by business ID
export async function getMenuByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    const items = await getMenuItems(businessId);
    const categories = await getMenuCategories(businessId);

    res.status(200).json({
      categories,
      items,
      formatted: formatMenuForCustomer(items, categories),
    });
  } catch (error) {
    logger.error('Failed to get menu', error);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
}

// Upload menu by business ID
export async function uploadMenuByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    await handleMenuUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload menu', error);
    res.status(500).json({ error: 'Failed to import menu' });
  }
}

// Upload CSV file by business ID
export async function uploadMenuFileByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    await handleMenuFileUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload menu file', error);
    res.status(500).json({ error: 'Failed to import menu' });
  }
}

// Export menu by business ID
export async function downloadMenuByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    await handleMenuExport(businessId, res);
  } catch (error) {
    logger.error('Failed to export menu', error);
    res.status(500).json({ error: 'Failed to export menu' });
  }
}

// Import from file by business ID
export async function importFromFileByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    await handleFileImport(businessId, req, res);
  } catch (error) {
    logger.error('Failed to import from file', error);
    res.status(500).json({ error: 'Failed to import menu from file' });
  }
}

// Upload addons by business ID
export async function uploadAddonsByBusinessId(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    await handleAddonsUpload(businessId, req, res);
  } catch (error) {
    logger.error('Failed to upload add-ons', error);
    res.status(500).json({ error: 'Failed to import add-ons' });
  }
}

// ============================================
// PUBLIC ROUTES (Templates)
// ============================================

// Download blank template
export async function downloadBlankTemplate(_req: Request, res: Response): Promise<void> {
  try {
    const blankTemplate = `category,item_name,description,price,sizes
Cakes,Black Forest,Classic black forest cake,,500g:400|1kg:750|2kg:1400,yes,yes,Best consumed within 24 hours
,,,,,,,
,,,,,,,
,,,,,,,`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=menu_template_blank.csv');
    res.status(200).send(blankTemplate);
  } catch (error) {
    logger.error('Failed to send blank template', error);
    res.status(500).json({ error: 'Failed to download template' });
  }
}

// Download sample template
export async function downloadSampleTemplate(_req: Request, res: Response): Promise<void> {
  try {
    const templatePath = path.join(__dirname, '../../templates/menu_template.csv');

    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=menu_template_sample.csv');
      res.status(200).send(template);
    } else {
      const sampleTemplate = `category,item_name,description,price,sizes
Cakes,Black Forest,Classic black forest cake with cherries,,500g:400|1kg:750|2kg:1400,yes,yes,Best consumed within 24 hours
Cakes,Chocolate Truffle,Rich chocolate truffle cake,,500g:350|1kg:650|2kg:1200,yes,yes,Keep refrigerated
Hot Beverages,Coffee,Fresh brewed coffee,,small:30|medium:50|large:70,no,no,
Hot Beverages,Tea,Kerala style chai,,small:20|medium:30|large:40,no,no,
Cold Beverages,Cool Coffee,Iced coffee,,small:50|medium:70|large:90,no,no,Shake before serving
Snacks,Sandwich,Veg club sandwich,80,,no,no,
Snacks,Samosa,Crispy samosa (2 pcs),30,,no,no,Best served hot`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=menu_template_sample.csv');
      res.status(200).send(sampleTemplate);
    }
  } catch (error) {
    logger.error('Failed to send sample template', error);
    res.status(500).json({ error: 'Failed to download template' });
  }
}

// Validate CSV
export async function validateMenu(req: Request, res: Response): Promise<void> {
  try {
    const { csv } = req.body;

    if (!csv) {
      res.status(400).json({ error: 'CSV content is required' });
      return;
    }

    const result = validateMenuCSV(csv);

    res.status(200).json(result);
  } catch (error) {
    logger.error('Failed to validate menu', error);
    res.status(500).json({ error: 'Failed to validate menu' });
  }
}

// Download addons template
export async function downloadAddonsTemplate(_req: Request, res: Response): Promise<void> {
  try {
    const templatePath = path.join(__dirname, '../../templates/addons_template.csv');

    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=addons_template.csv');
      res.status(200).send(template);
    } else {
      const defaultTemplate = `addon_name,category,description,price,link_to_categories,is_auto_suggested
Standard Candle,candle,Basic birthday candle,,Cakes,yes
Number Candle,candle,Custom number candle,50,Cakes,yes
Extra Cheese,topping,Additional cheese slice,20,Snacks,yes`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=addons_template.csv');
      res.status(200).send(defaultTemplate);
    }
  } catch (error) {
    logger.error('Failed to send add-ons template', error);
    res.status(500).json({ error: 'Failed to download add-ons template' });
  }
}

// ============================================
// SHARED HELPER FUNCTIONS
// ============================================

async function handleMenuUpload(businessId: string, req: Request, res: Response): Promise<void> {
  const { csv, replace } = req.body;

  if (!csv) {
    res.status(400).json({ error: 'CSV content is required in request body' });
    return;
  }

  // Verify business exists
  const business = await getBusinessById(businessId);
  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  // Validate CSV first
  const validation = validateMenuCSV(csv);
  if (!validation.valid) {
    res.status(400).json({
      error: 'Invalid CSV format',
      details: validation.errors,
    });
    return;
  }

  // Import menu
  const result = await importMenuFromCSV(businessId, csv, replace === true);

  // Clear cache after import
  clearMenuCache(businessId);

  if (result.success) {
    res.status(200).json({
      message: 'Menu imported successfully',
      ...result,
    });
  } else {
    res.status(207).json({
      message: 'Menu imported with some errors',
      ...result,
    });
  }
}

async function handleMenuFileUpload(businessId: string, req: Request, res: Response): Promise<void> {
  const replace = req.query.replace === 'true';

  // Check if file was uploaded
  if (!req.file) {
    res.status(400).json({ error: 'No CSV file uploaded. Use form field name "menu"' });
    return;
  }

  // Verify business exists
  const business = await getBusinessById(businessId);
  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  // Read CSV content from uploaded file
  const csv = req.file.buffer.toString('utf-8');

  // Validate CSV
  const validation = validateMenuCSV(csv);
  if (!validation.valid) {
    res.status(400).json({
      error: 'Invalid CSV format',
      details: validation.errors,
    });
    return;
  }

  // Import menu
  const result = await importMenuFromCSV(businessId, csv, replace);

  // Clear cache
  clearMenuCache(businessId);

  res.status(200).json({
    message: result.success ? 'Menu imported successfully' : 'Menu imported with errors',
    fileName: req.file.originalname,
    ...result,
  });
}

async function handleMenuExport(businessId: string, res: Response): Promise<void> {
  const csv = await exportMenuToCSV(businessId);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=menu_${businessId}.csv`);
  res.status(200).send(csv);
}

async function handleFileImport(businessId: string, req: Request, res: Response): Promise<void> {
  const { filePath, replace } = req.body;

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  // Read file
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    res.status(404).json({ error: `File not found: ${filePath}` });
    return;
  }

  const csv = fs.readFileSync(absolutePath, 'utf-8');

  // Validate
  const validation = validateMenuCSV(csv);
  if (!validation.valid) {
    res.status(400).json({
      error: 'Invalid CSV format',
      details: validation.errors,
    });
    return;
  }

  // Import
  const result = await importMenuFromCSV(businessId, csv, replace === true);

  // Clear cache
  clearMenuCache(businessId);

  res.status(200).json({
    message: result.success ? 'Menu imported successfully' : 'Menu imported with errors',
    ...result,
  });
}

async function handleAddonsUpload(businessId: string, req: Request, res: Response): Promise<void> {
  const { csv, replace } = req.body;

  if (!csv) {
    res.status(400).json({ error: 'CSV content is required in request body' });
    return;
  }

  // Verify business exists
  const business = await getBusinessById(businessId);
  if (!business) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }

  // Import add-ons
  const result = await importAddonsFromCSV(businessId, csv, replace === true);

  if (result.success) {
    res.status(200).json({
      message: 'Add-ons imported successfully',
      ...result,
    });
  } else {
    res.status(207).json({
      message: 'Add-ons imported with some errors',
      ...result,
    });
  }
}
