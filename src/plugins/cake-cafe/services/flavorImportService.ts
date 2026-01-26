import { supabase } from '@/config/database';
import { CakeFlavorPricing, CakeFlavorSize } from '@/types';
import { logger } from '@/utils/logger';

interface CSVFlavorRow {
    flavor_name: string;
    sizes: string;
    is_active?: string;
}

interface ImportResult {
    success: boolean;
    flavorsCreated: number;
    flavorsUpdated: number;
    errors: string[];
}

// Parse CSV content handling multiline quoted fields
function parseCSVWithMultiline(content: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                currentField += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            // End of field
            currentRow.push(currentField.trim());
            currentField = '';
        } else if (char === '\n' && !inQuotes) {
            // End of row
            currentRow.push(currentField.trim());
            if (currentRow.some(field => field !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
        } else if (char === '\r') {
            // Skip carriage return
            continue;
        } else {
            currentField += char;
        }
    }

    // Don't forget the last field/row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field !== '')) {
            rows.push(currentRow);
        }
    }

    return rows;
}

// Parse CSV/TSV string to rows
function parseCSV(csvContent: string): CSVFlavorRow[] {
    const firstLine = csvContent.split('\n')[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    const allRows = parseCSVWithMultiline(csvContent, delimiter);

    if (allRows.length < 2) {
        throw new Error('CSV must have header row and at least one data row');
    }

    const requiredHeaders = ['flavor_name', 'sizes'];
    const headerRow = allRows[0];
    const headers = headerRow.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

    const missingHeaders = requiredHeaders.filter(rh => !headers.includes(rh));
    if (missingHeaders.length > 0) {
        throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
    }

    const rows: CSVFlavorRow[] = [];
    for (let i = 1; i < allRows.length; i++) {
        const values = allRows[i];
        if (values.length === 0 || values.every(v => !v.trim())) continue;

        const row: Record<string, string> = {};
        headers.forEach((header, index) => {
            if (header) {
                row[header] = values[index]?.trim() || '';
            }
        });

        if (!row.flavor_name) continue;

        rows.push(row as unknown as CSVFlavorRow);
    }

    return rows;
}

/**
 * Parse sizes string like "500g:400:true|1kg:750:false"
 * Format: name:price:is_base|name:price:is_base
 */
function parseFlavorSizes(sizesStr: string): CakeFlavorSize[] | null {
    if (!sizesStr || sizesStr.trim() === '') {
        return null;
    }

    const sizes: CakeFlavorSize[] = [];
    const sizeEntries = sizesStr.split('|');

    for (const entry of sizeEntries) {
        const parts = entry.split(':').map(s => s.trim());
        const [name, priceStr, isBaseStr] = parts;

        if (name && priceStr) {
            const price = parseFloat(priceStr);
            if (!isNaN(price)) {
                let is_base = false;
                if (isBaseStr) {
                    is_base = isBaseStr.toLowerCase() === 'true' || isBaseStr.toLowerCase() === 'base' || isBaseStr.toLowerCase() === '1';
                }
                sizes.push({ name, price, is_base });
            }
        }
    }

    // If no size is marked as base, mark the first one
    if (sizes.length > 0 && !sizes.some(s => s.is_base)) {
        sizes[0].is_base = true;
    }

    return sizes.length > 0 ? sizes : null;
}

/**
 * Import flavors from CSV content
 */
export async function importFlavorsFromCSV(
    businessId: string,
    csvContent: string,
    replaceExisting: boolean = false
): Promise<ImportResult> {
    const result: ImportResult = {
        success: false,
        flavorsCreated: 0,
        flavorsUpdated: 0,
        errors: [],
    };

    try {
        const rows = parseCSV(csvContent);

        if (rows.length === 0) {
            result.errors.push('No valid flavors found in CSV');
            return result;
        }

        if (replaceExisting) {
            await supabase
                .from('cake_flavor_pricing')
                .delete()
                .eq('business_id', businessId);
            logger.info(`Cleared existing flavor data for business ${businessId}`);
        }

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;

            try {
                if (!row.flavor_name) {
                    result.errors.push(`Row ${rowNum}: Missing flavor name`);
                    continue;
                }

                const sizes = parseFlavorSizes(row.sizes);
                if (!sizes) {
                    result.errors.push(`Row ${rowNum}: Invalid sizes format for flavor "${row.flavor_name}"`);
                    continue;
                }

                const isActive = row.is_active ? (row.is_active.toLowerCase() !== 'false' && row.is_active !== '0') : true;

                // Check if flavor exists for this business
                const { data: existingFlavor } = await supabase
                    .from('cake_flavor_pricing')
                    .select('id')
                    .eq('business_id', businessId)
                    .eq('flavor_name', row.flavor_name)
                    .single();

                const flavorData = {
                    business_id: businessId,
                    flavor_name: row.flavor_name,
                    sizes: sizes,
                    is_active: isActive,
                    updated_at: new Date().toISOString(),
                };

                if (existingFlavor) {
                    const { error } = await supabase
                        .from('cake_flavor_pricing')
                        .update(flavorData)
                        .eq('id', existingFlavor.id);

                    if (error) {
                        result.errors.push(`Row ${rowNum}: Failed to update "${row.flavor_name}": ${error.message}`);
                    } else {
                        result.flavorsUpdated++;
                    }
                } else {
                    const { error } = await supabase
                        .from('cake_flavor_pricing')
                        .insert({
                            ...flavorData,
                            created_at: new Date().toISOString(),
                        });

                    if (error) {
                        result.errors.push(`Row ${rowNum}: Failed to create "${row.flavor_name}": ${error.message}`);
                    } else {
                        result.flavorsCreated++;
                    }
                }
            } catch (rowError) {
                result.errors.push(`Row ${rowNum}: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`);
            }
        }

        result.success = result.errors.length === 0;
    } catch (error) {
        result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        logger.error('Flavor import failed', error);
    }

    return result;
}

/**
 * Export flavors to CSV format
 */
export async function exportFlavorsToCSV(businessId: string): Promise<string> {
    const { data: flavors, error } = await supabase
        .from('cake_flavor_pricing')
        .select('*')
        .eq('business_id', businessId)
        .order('flavor_name');

    if (error) {
        throw new Error(`Failed to fetch flavors: ${error.message}`);
    }

    const headers = 'flavor_name,sizes,is_active';
    const rows: string[] = [headers];

    for (const flavor of flavors || []) {
        const sizesStr = (flavor.sizes as CakeFlavorSize[])
            .map(s => `${s.name}:${s.price}:${s.is_base}`)
            .join('|');

        const row = [
            escapeCSV(flavor.flavor_name),
            escapeCSV(sizesStr),
            flavor.is_active ? 'true' : 'false',
        ].join(',');

        rows.push(row);
    }

    return rows.join('\n');
}

/**
 * Escape CSV field
 */
function escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/**
 * Validate Flavor CSV format
 */
export function validateFlavorCSV(csvContent: string): { valid: boolean; errors: string[]; rowCount: number } {
    const errors: string[] = [];

    try {
        const rows = parseCSV(csvContent);

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2;

            if (!row.flavor_name) {
                errors.push(`Row ${rowNum}: Missing flavor name`);
            }
            if (!row.sizes) {
                errors.push(`Row ${rowNum}: Missing sizes`);
            } else if (!parseFlavorSizes(row.sizes)) {
                errors.push(`Row ${rowNum}: Invalid sizes format. Use "name:price:is_base|name:price"`);
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
