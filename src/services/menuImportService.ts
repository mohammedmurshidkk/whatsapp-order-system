import { supabase } from '../config/database';
import { MenuCategory, MenuItem, MenuItemSize } from '../types';
import { logger } from '../utils/logger';

interface CSVMenuRow {
  category: string;
  item_name: string;
  description: string;
  price: string;
  sizes: string;
  is_customizable: string;
  requires_date: string;
  special_notes: string;
}

interface ImportResult {
  success: boolean;
  categoriesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  errors: string[];
}

// Parse CSV string to rows
function parseCSV(csvContent: string): CSVMenuRow[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must have header row and at least one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: CSVMenuRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV parsing with potential commas in quoted fields
    const values = parseCSVLine(line);

    if (values.length < headers.length) {
      continue; // Skip incomplete rows
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || '';
    });

    // Skip empty rows
    if (!row.category && !row.item_name) continue;

    rows.push(row as unknown as CSVMenuRow);
  }

  return rows;
}

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Parse sizes string like "500g:400|1kg:750|2kg:1400"
function parseSizes(sizesStr: string): MenuItemSize[] | null {
  if (!sizesStr || sizesStr.trim() === '') {
    return null;
  }

  const sizes: MenuItemSize[] = [];
  const sizeEntries = sizesStr.split('|');

  for (const entry of sizeEntries) {
    const [name, priceStr] = entry.split(':').map(s => s.trim());
    if (name && priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        sizes.push({ name, price });
      }
    }
  }

  return sizes.length > 0 ? sizes : null;
}

// Convert yes/no/true/false to boolean
function parseBoolean(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '1';
}

// Get or create category
async function getOrCreateCategory(
  businessId: string,
  categoryName: string,
  categoryOrder: Map<string, number>
): Promise<string> {
  // Check if category exists
  const { data: existing } = await supabase
    .from('menu_categories')
    .select('id')
    .eq('business_id', businessId)
    .eq('name', categoryName)
    .single();

  if (existing) {
    return existing.id;
  }

  // Create new category
  const order = categoryOrder.get(categoryName) || categoryOrder.size + 1;
  categoryOrder.set(categoryName, order);

  const { data: newCategory, error } = await supabase
    .from('menu_categories')
    .insert({
      business_id: businessId,
      name: categoryName,
      display_order: order,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create category ${categoryName}: ${error.message}`);
  }

  return newCategory.id;
}

// Import menu from CSV content
export async function importMenuFromCSV(
  businessId: string,
  csvContent: string,
  replaceExisting: boolean = false
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    categoriesCreated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
    errors: [],
  };

  try {
    // Parse CSV
    const rows = parseCSV(csvContent);

    if (rows.length === 0) {
      result.errors.push('No valid menu items found in CSV');
      return result;
    }

    logger.info(`Parsed ${rows.length} menu items from CSV`);

    // If replacing, delete existing menu items and categories
    if (replaceExisting) {
      await supabase
        .from('menu_items')
        .delete()
        .eq('business_id', businessId);

      await supabase
        .from('menu_categories')
        .delete()
        .eq('business_id', businessId);

      logger.info('Cleared existing menu data');
    }

    // Track categories for ordering
    const categoryOrder = new Map<string, number>();
    const existingCategories = new Set<string>();

    // Get existing categories count
    const { data: existingCats } = await supabase
      .from('menu_categories')
      .select('name')
      .eq('business_id', businessId);

    if (existingCats) {
      existingCats.forEach(c => existingCategories.add(c.name));
    }

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header

      try {
        // Validate required fields
        if (!row.item_name) {
          result.errors.push(`Row ${rowNum}: Missing item name`);
          continue;
        }

        if (!row.category) {
          result.errors.push(`Row ${rowNum}: Missing category for "${row.item_name}"`);
          continue;
        }

        // Get or create category
        const wasNewCategory = !existingCategories.has(row.category);
        const categoryId = await getOrCreateCategory(businessId, row.category, categoryOrder);

        if (wasNewCategory) {
          existingCategories.add(row.category);
          result.categoriesCreated++;
        }

        // Parse item data
        const sizes = parseSizes(row.sizes);
        const price = row.price ? parseFloat(row.price) : null;

        // Check if item exists (for update)
        const { data: existingItem } = await supabase
          .from('menu_items')
          .select('id')
          .eq('business_id', businessId)
          .eq('name', row.item_name)
          .single();

        const itemData = {
          business_id: businessId,
          category_id: categoryId,
          name: row.item_name,
          description: row.description || null,
          price: sizes ? null : price, // Only set price if no sizes
          sizes: sizes,
          is_customizable: parseBoolean(row.is_customizable),
          requires_date: parseBoolean(row.requires_date),
          special_notes: row.special_notes || null,
          is_available: true,
        };

        if (existingItem) {
          // Update existing item
          const { error } = await supabase
            .from('menu_items')
            .update(itemData)
            .eq('id', existingItem.id);

          if (error) {
            result.errors.push(`Row ${rowNum}: Failed to update "${row.item_name}": ${error.message}`);
          } else {
            result.itemsUpdated++;
          }
        } else {
          // Create new item
          const { error } = await supabase
            .from('menu_items')
            .insert(itemData);

          if (error) {
            result.errors.push(`Row ${rowNum}: Failed to create "${row.item_name}": ${error.message}`);
          } else {
            result.itemsCreated++;
          }
        }

      } catch (rowError) {
        result.errors.push(`Row ${rowNum}: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`);
      }
    }

    result.success = result.errors.length === 0;

    logger.info(`Import complete: ${result.categoriesCreated} categories, ${result.itemsCreated} items created, ${result.itemsUpdated} items updated`);

    if (result.errors.length > 0) {
      logger.warn(`Import had ${result.errors.length} errors`);
    }

  } catch (error) {
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error('Menu import failed', error);
  }

  return result;
}

// Export menu to CSV format
export async function exportMenuToCSV(businessId: string): Promise<string> {
  const { data: items, error } = await supabase
    .from('menu_items')
    .select(`
      *,
      category:menu_categories(name)
    `)
    .eq('business_id', businessId)
    .order('category_id');

  if (error) {
    throw new Error(`Failed to fetch menu: ${error.message}`);
  }

  // Build CSV
  const headers = 'category,item_name,description,price,sizes,is_customizable,requires_date,special_notes';
  const rows: string[] = [headers];

  for (const item of items || []) {
    const categoryName = (item.category as any)?.name || '';
    const sizesStr = item.sizes
      ? (item.sizes as MenuItemSize[]).map(s => `${s.name}:${s.price}`).join('|')
      : '';

    const row = [
      escapeCSV(categoryName),
      escapeCSV(item.name),
      escapeCSV(item.description || ''),
      item.price?.toString() || '',
      sizesStr,
      item.is_customizable ? 'yes' : 'no',
      item.requires_date ? 'yes' : 'no',
      escapeCSV((item as any).special_notes || ''),
    ].join(',');

    rows.push(row);
  }

  return rows.join('\n');
}

// Escape CSV field
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Validate CSV format without importing
export function validateMenuCSV(csvContent: string): { valid: boolean; errors: string[]; rowCount: number } {
  const errors: string[] = [];

  try {
    const rows = parseCSV(csvContent);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (!row.item_name) {
        errors.push(`Row ${rowNum}: Missing item name`);
      }
      if (!row.category) {
        errors.push(`Row ${rowNum}: Missing category`);
      }
      if (row.sizes && !parseSizes(row.sizes)) {
        errors.push(`Row ${rowNum}: Invalid sizes format. Use "size:price|size:price"`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      rowCount: rows.length,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`CSV parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      rowCount: 0,
    };
  }
}
