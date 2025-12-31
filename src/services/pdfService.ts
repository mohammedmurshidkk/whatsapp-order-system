import puppeteer from 'puppeteer';
import { supabase } from '../config/database';
import { getMenuItems, getMenuCategories, clearMenuCache } from './menuService';
import { getBusinessById } from './menuService';
import { logger } from '../utils/logger';
import { MenuItem, MenuCategory } from '../types';

const BUCKET_NAME = 'menu-pdfs';

/**
 * Generate styled HTML for menu PDF - Matching sample design
 * 2 categories side-by-side, black header bars, white background
 */
function generateMenuHtml(
  businessName: string,
  categories: MenuCategory[],
  items: MenuItem[]
): string {
  // Group items by category
  const categoryMap = new Map<string, MenuItem[]>();
  for (const item of items) {
    if (item.category_id) {
      const existing = categoryMap.get(item.category_id) || [];
      existing.push(item);
      categoryMap.set(item.category_id, existing);
    }
  }

  // Filter categories that have items
  const activeCategories = categories.filter(cat => {
    const catItems = categoryMap.get(cat.id);
    return catItems && catItems.length > 0;
  });

  // Helper to generate category HTML
  const generateCategoryHtml = (category: MenuCategory, isFullWidth: boolean = false): string => {
    const categoryItems = categoryMap.get(category.id) || [];
    const hasSizes = categoryItems.some(item => item.sizes && item.sizes.length > 0);

    if (hasSizes) {
      // Get all unique size names
      const allSizes = new Set<string>();
      categoryItems.forEach(item => {
        item.sizes?.forEach(s => allSizes.add(s.name));
      });
      const sizeNames = Array.from(allSizes);

      return `
        <div class="category-box ${isFullWidth ? 'full-width' : ''}">
          <div class="category-header">${category.name.toUpperCase()}</div>
          <div class="category-content">
            <div class="size-row">
              ${sizeNames.map(sizeName => `<div class="size-label">${sizeName}</div>`).join('')}
            </div>
            ${categoryItems.map(item => `
              <div class="item-row-sizes">
                <div class="item-info-sizes">
                  <div class="item-name">${item.name.toUpperCase()}</div>
                  ${item.description ? `<div class="item-desc">${item.description}</div>` : ''}
                </div>
                <div class="item-prices">
                  ${sizeNames.map(sizeName => {
                    const sizeData = item.sizes?.find(s => s.name === sizeName);
                    return `<div class="item-price">${sizeData ? sizeData.price : '-'}</div>`;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      // Simple items
      return `
        <div class="category-box ${isFullWidth ? 'full-width' : ''}">
          <div class="category-header">${category.name.toUpperCase()}</div>
          <div class="category-content">
            ${categoryItems.map(item => `
              <div class="item-row">
                <div class="item-info">
                  <div class="item-name">${item.name.toUpperCase()}</div>
                  ${item.description ? `<div class="item-desc">${item.description}</div>` : ''}
                </div>
                <div class="item-price">${item.price || '-'}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  };

  // Build sections - pair categories side by side
  let sectionsHtml = '';
  let i = 0;
  while (i < activeCategories.length) {
    const cat1 = activeCategories[i];
    const cat2 = activeCategories[i + 1];
    const cat1Items = categoryMap.get(cat1.id) || [];
    const cat2Items = cat2 ? (categoryMap.get(cat2.id) || []) : [];

    // Check if categories have sizes (need more space)
    const cat1HasSizes = cat1Items.some(item => item.sizes && item.sizes.length > 0);
    const cat2HasSizes = cat2Items.some(item => item.sizes && item.sizes.length > 0);

    // Make full width if: many sizes, many items, or big size difference between pairs
    const cat1NeedsFullWidth =
      (cat1HasSizes && cat1Items.some(item => (item.sizes?.length || 0) > 2)) ||
      cat1Items.length > 12;
    const cat2NeedsFullWidth = cat2 && (
      (cat2HasSizes && cat2Items.some(item => (item.sizes?.length || 0) > 2)) ||
      cat2Items.length > 12
    );

    if (cat1NeedsFullWidth || !cat2) {
      // Single full-width category
      sectionsHtml += `<div class="row">${generateCategoryHtml(cat1, true)}</div>`;
      i += 1;
    } else if (cat2NeedsFullWidth) {
      // First one in its own row, second one full width
      sectionsHtml += `<div class="row">${generateCategoryHtml(cat1, true)}</div>`;
      sectionsHtml += `<div class="row">${generateCategoryHtml(cat2, true)}</div>`;
      i += 2;
    } else {
      // Two categories side by side
      sectionsHtml += `
        <div class="row">
          ${generateCategoryHtml(cat1)}
          ${generateCategoryHtml(cat2)}
        </div>
      `;
      i += 2;
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Georgia', 'Times New Roman', serif;
          background-color: #f5f5f5;
          color: #1a1a1a;
          padding: 20px 25px;
          font-size: 10px;
        }

        .header {
          background: #1a1a1a;
          color: #fff;
          padding: 20px 30px;
          margin: -20px -25px 20px -25px;
          text-align: center;
        }

        .business-name {
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 4px;
          text-transform: uppercase;
        }

        .menu-subtitle {
          font-size: 11px;
          letter-spacing: 2px;
          margin-top: 5px;
          opacity: 0.8;
        }

        .row {
          display: flex;
          gap: 15px;
          margin-bottom: 15px;
          align-items: flex-start;
        }

        .category-box {
          flex: 1;
          background: #fff;
          border: 1px solid #e0e0e0;
        }

        .category-box.full-width {
          flex: 1 1 100%;
        }

        .category-header {
          background: #1a1a1a;
          color: #fff;
          padding: 8px 15px;
          font-size: 13px;
          font-weight: bold;
          letter-spacing: 3px;
          text-align: center;
          break-after: avoid;
        }

        .category-content {
          padding: 12px 15px;
        }

        .item-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 6px 0;
          border-bottom: 1px solid #eee;
        }

        .item-row:last-child {
          border-bottom: none;
        }

        .item-info {
          flex: 1;
          padding-right: 10px;
        }

        .item-name {
          font-size: 10px;
          font-weight: bold;
          color: #1a1a1a;
          letter-spacing: 0.5px;
        }

        .item-desc {
          font-size: 8px;
          color: #666;
          margin-top: 2px;
          line-height: 1.3;
        }

        .item-price {
          font-size: 10px;
          font-weight: bold;
          color: #1a1a1a;
          min-width: 35px;
          text-align: right;
        }

        /* Size-based items */
        .size-row {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-bottom: 6px;
          margin-bottom: 6px;
          border-bottom: 2px solid #1a1a1a;
        }

        .size-label {
          font-size: 9px;
          font-weight: bold;
          color: #1a1a1a;
          min-width: 45px;
          text-align: center;
          background: #f0f0f0;
          padding: 3px 8px;
          border-radius: 3px;
        }

        .item-row-sizes {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 0;
          border-bottom: 1px solid #eee;
        }

        .item-row-sizes:last-child {
          border-bottom: none;
        }

        .item-info-sizes {
          flex: 1;
        }

        .item-row-sizes .item-name {
          flex: 1;
        }

        .item-prices {
          display: flex;
          gap: 10px;
        }

        .item-prices .item-price {
          min-width: 45px;
          text-align: center;
        }

        .footer {
          text-align: center;
          margin-top: 15px;
          padding-top: 10px;
          border-top: 1px solid #ddd;
        }

        .footer-text {
          font-size: 8px;
          color: #888;
        }

        @page {
          margin: 8mm;
          size: A4;
        }

        @media print {
          body {
            padding: 10px;
          }
          .header {
            margin: -10px -10px 15px -10px;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="business-name">${businessName}</div>
        <div class="menu-subtitle">MENU</div>
      </div>

      ${sectionsHtml}

      <div class="footer">
        <div class="footer-text">Prices subject to change • All prices in ₹</div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate PDF from menu data using Puppeteer
 */
export async function generateMenuPdf(businessId: string): Promise<Buffer> {
  const [business, items, categories] = await Promise.all([
    getBusinessById(businessId),
    getMenuItems(businessId),
    getMenuCategories(businessId),
  ]);

  if (!business) {
    throw new Error('Business not found');
  }

  if (items.length === 0) {
    throw new Error('No menu items found');
  }

  const html = generateMenuHtml(business.name, categories, items);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Upload PDF to Supabase Storage
 */
export async function uploadMenuPdf(
  businessId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const filePath = `${businessId}/menu.pdf`;

  // Upload (upsert) to Supabase storage
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    logger.error('Failed to upload PDF to Supabase', error);
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

/**
 * Generate and upload menu PDF for a business
 * Returns the public URL of the uploaded PDF
 */
export async function syncMenuPdf(businessId: string): Promise<string> {
  logger.info(`Syncing menu PDF for business: ${businessId}`);

  // Clear menu cache to ensure fresh data
  clearMenuCache(businessId);

  // Generate PDF
  const pdfBuffer = await generateMenuPdf(businessId);

  // Upload to Supabase with timestamp to bust cache
  const publicUrl = await uploadMenuPdf(businessId, pdfBuffer);

  logger.info(`Menu PDF synced: ${publicUrl}`);

  // Return URL with cache-busting query param
  return `${publicUrl}?v=${Date.now()}`;
}

/**
 * Get the public URL for a business's menu PDF
 * Includes cache-busting query param
 */
export function getMenuPdfUrl(businessId: string): string {
  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(`${businessId}/menu.pdf`);

  // Add cache-busting param to ensure fresh PDF
  return `${data.publicUrl}?v=${Date.now()}`;
}

/**
 * Check if menu PDF exists for a business
 */
export async function menuPdfExists(businessId: string): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(businessId, { search: 'menu.pdf' });

  if (error) {
    return false;
  }

  return data.some(file => file.name === 'menu.pdf');
}
