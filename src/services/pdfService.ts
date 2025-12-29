import puppeteer from 'puppeteer';
import { supabase } from '../config/database';
import { getMenuItems, getMenuCategories, clearMenuCache } from './menuService';
import { getBusinessById } from './menuService';
import { logger } from '../utils/logger';
import { MenuItem, MenuCategory } from '../types';

const BUCKET_NAME = 'menu-pdfs';

/**
 * Generate styled HTML for menu PDF
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

  // Build category sections HTML
  let sectionsHtml = '';
  for (const category of categories) {
    const categoryItems = categoryMap.get(category.id);
    if (!categoryItems || categoryItems.length === 0) continue;

    // Check if items have sizes (for column layout)
    const hasSizes = categoryItems.some(item => item.sizes && item.sizes.length > 0);

    if (hasSizes) {
      // Get all unique size names
      const allSizes = new Set<string>();
      categoryItems.forEach(item => {
        item.sizes?.forEach(s => allSizes.add(s.name));
      });
      const sizeNames = Array.from(allSizes);

      sectionsHtml += `
        <div class="category-section">
          <div class="category-header">${category.name.toUpperCase()}</div>
          <div class="size-columns">
            ${sizeNames.map(sizeName => `
              <div class="size-column">
                <div class="size-header">${sizeName}</div>
                ${categoryItems.map(item => {
                  const sizeData = item.sizes?.find(s => s.name === sizeName);
                  if (!sizeData) return '';
                  return `
                    <div class="item-row">
                      <span class="item-name">${item.name}</span>
                      <span class="item-price">${sizeData.price}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      // Simple list layout (no sizes)
      sectionsHtml += `
        <div class="category-section">
          <div class="category-header-decorated">
            <span class="header-line"></span>
            <span class="header-text">${category.name.toUpperCase()}</span>
            <span class="header-line"></span>
          </div>
          <div class="items-list">
            ${categoryItems.map(item => `
              <div class="item-card">
                <div class="item-info">
                  <div class="item-name-large">${item.name}</div>
                  ${item.description ? `<div class="item-description">${item.description}</div>` : ''}
                </div>
                <div class="item-price-large">${item.price || '-'}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
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
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #C4A77D;
          color: #2D2D2D;
          padding: 40px;
        }

        .header {
          text-align: center;
          margin-bottom: 40px;
        }

        .business-name {
          font-size: 36px;
          font-weight: bold;
          color: #3D2B1F;
          letter-spacing: 4px;
          text-transform: uppercase;
        }

        .menu-title {
          font-size: 18px;
          color: #5D4E37;
          margin-top: 8px;
          letter-spacing: 2px;
        }

        .category-section {
          margin-bottom: 40px;
          page-break-inside: avoid;
        }

        /* Decorated header style (like Sandwiches sample) */
        .category-header-decorated {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }

        .header-line {
          flex: 1;
          height: 2px;
          background: linear-gradient(to right, transparent, #3D2B1F, transparent);
          max-width: 100px;
        }

        .header-text {
          font-size: 28px;
          font-weight: bold;
          color: #3D2B1F;
          padding: 0 20px;
          letter-spacing: 6px;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
        }

        /* Simple category header (for size-based) */
        .category-header {
          font-size: 24px;
          font-weight: bold;
          color: #3D2B1F;
          text-align: center;
          margin-bottom: 20px;
          letter-spacing: 4px;
        }

        /* Size columns layout (like 1KG/500G sample) */
        .size-columns {
          display: flex;
          gap: 40px;
          justify-content: center;
        }

        .size-column {
          flex: 1;
          max-width: 300px;
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 20px;
        }

        .size-header {
          background: #3D2B1F;
          color: #fff;
          padding: 10px 30px;
          border-radius: 20px;
          text-align: center;
          font-weight: bold;
          font-size: 18px;
          margin-bottom: 20px;
          display: inline-block;
          width: 100%;
        }

        .item-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px dotted rgba(61, 43, 31, 0.3);
        }

        .item-row:last-child {
          border-bottom: none;
        }

        .item-name {
          font-weight: 600;
          color: #2D2D2D;
          font-size: 14px;
          text-transform: uppercase;
        }

        .item-price {
          font-weight: bold;
          color: #3D2B1F;
          font-size: 14px;
        }

        /* Items list layout (for non-size items) */
        .items-list {
          background: rgba(61, 43, 31, 0.9);
          border-radius: 12px;
          padding: 30px;
          border: 2px solid rgba(196, 167, 125, 0.5);
        }

        .item-card {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 15px 0;
          border-bottom: 1px solid rgba(196, 167, 125, 0.3);
        }

        .item-card:last-child {
          border-bottom: none;
        }

        .item-info {
          flex: 1;
          padding-right: 20px;
        }

        .item-name-large {
          font-size: 20px;
          font-weight: bold;
          color: #E8DCC8;
          margin-bottom: 5px;
        }

        .item-description {
          font-size: 13px;
          color: #B8A88A;
          line-height: 1.4;
          font-style: italic;
        }

        .item-price-large {
          font-size: 22px;
          font-weight: bold;
          color: #E8DCC8;
          min-width: 80px;
          text-align: right;
        }

        .footer {
          text-align: center;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 2px solid rgba(61, 43, 31, 0.3);
        }

        .footer-text {
          font-size: 12px;
          color: #5D4E37;
        }

        @media print {
          body {
            padding: 20px;
          }
          .category-section {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="business-name">${businessName}</div>
        <div class="menu-title">MENU</div>
      </div>

      ${sectionsHtml}

      <div class="footer">
        <div class="footer-text">Prices are subject to change. All prices in INR.</div>
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
