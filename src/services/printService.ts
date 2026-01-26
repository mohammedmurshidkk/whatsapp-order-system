import * as net from 'net';
import { supabase } from '../config/database';
import { Order, OrderItemData, Business, BusinessOutlet } from '../types';
import { logger } from '../utils/logger';
import { generateGoogleMapsLink, isValidCoordinates } from '../utils/locationUtils';

// ESC/POS Commands for 80mm thermal printer
const ESC = '\x1B';
const GS = '\x1D';
const ESCPOS = {
  INIT: ESC + '@',                    // Initialize printer
  ALIGN_LEFT: ESC + 'a' + '\x00',
  ALIGN_CENTER: ESC + 'a' + '\x01',
  ALIGN_RIGHT: ESC + 'a' + '\x02',
  BOLD_ON: ESC + 'E' + '\x01',
  BOLD_OFF: ESC + 'E' + '\x00',
  DOUBLE_HEIGHT: ESC + '!' + '\x10',
  DOUBLE_WIDTH: ESC + '!' + '\x20',
  DOUBLE_SIZE: ESC + '!' + '\x30',
  NORMAL_SIZE: ESC + '!' + '\x00',
  UNDERLINE_ON: ESC + '-' + '\x01',
  UNDERLINE_OFF: ESC + '-' + '\x00',
  CUT_PAPER: GS + 'V' + '\x00',       // Full cut
  CUT_PARTIAL: GS + 'V' + '\x01',     // Partial cut
  FEED_LINES: (n: number) => ESC + 'd' + String.fromCharCode(n),
  LINE: '--------------------------------',
  DOUBLE_LINE: '================================',
};

/**
 * Generate ESC/POS QR code commands
 * Uses GS ( k command for QR code generation
 * @param data - The data to encode in QR code (e.g., Google Maps URL)
 * @param size - Module size (1-16, default 4)
 */
function generateQRCodeCommand(data: string, size: number = 4): string {
  const dataLen = data.length + 3;
  const pL = dataLen % 256;
  const pH = Math.floor(dataLen / 256);

  let cmd = '';

  // QR Code: Select model (Model 2)
  cmd += GS + '(k' + '\x04\x00' + '\x31\x41' + '\x32\x00';

  // QR Code: Set size of module
  cmd += GS + '(k' + '\x03\x00' + '\x31\x43' + String.fromCharCode(size);

  // QR Code: Set error correction level (L=48, M=49, Q=50, H=51)
  cmd += GS + '(k' + '\x03\x00' + '\x31\x45' + '\x31'; // Level M

  // QR Code: Store data
  cmd += GS + '(k' + String.fromCharCode(pL) + String.fromCharCode(pH) + '\x31\x50\x30' + data;

  // QR Code: Print
  cmd += GS + '(k' + '\x03\x00' + '\x31\x51\x30';

  return cmd;
}

// Paper width for 80mm printer (48 characters in standard font)
const PAPER_WIDTH = 48;

interface PrintOrderData {
  order: Order;
  business: Business;
  customer: { phone: string; name: string | null };
  outlet?: BusinessOutlet | null;
}

// Editable print data - all fields can be modified before printing
export interface EditablePrintItem {
  name: string;
  quantity: number;
  size_or_weight?: string;
  unit_price?: number;
  line_total?: number;
  custom_text?: string;
  delivery_date?: string;
  notes?: string;
  addons?: Array<{
    addon_name: string;
    quantity: number;
    unit_price?: number;
    line_total?: number;
  }>;
}

export interface EditablePrintData {
  // Order info
  order_number: string;
  order_date: string;
  order_time: string;

  // Business info
  business_name: string;

  // Customer info
  customer_name: string;
  customer_phone: string;

  // Items (fully editable)
  items: EditablePrintItem[];

  // Totals
  subtotal: number;
  delivery_fee: number;
  grand_total: number;

  // Fulfillment
  fulfillment_type: 'delivery' | 'takeaway';
  delivery_address?: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  delivery_time?: string;
  outlet_name?: string;
  outlet_address?: string;
  pickup_time?: string;

  // Special note (new field for admin to add)
  sp_note?: string;
}

/**
 * Fetch all data needed for printing an order
 */
export async function getOrderPrintData(orderId: string): Promise<PrintOrderData | null> {
  // Get order with customer
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(`
      *,
      customers (
        phone,
        name
      ),
      businesses (
        id,
        name,
        phone,
        address,
        currency,
        timezone
      )
    `)
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    logger.error('Failed to fetch order for printing', orderError);
    return null;
  }

  // Get outlet if pickup order
  let outlet: BusinessOutlet | null = null;
  if (order.pickup_outlet_id) {
    const { data: outletData } = await supabase
      .from('business_outlets')
      .select('*')
      .eq('id', order.pickup_outlet_id)
      .single();
    outlet = outletData as BusinessOutlet | null;
  }

  return {
    order: order as Order,
    business: (order as any).businesses as Business,
    customer: (order as any).customers as { phone: string; name: string | null },
    outlet,
  };
}

/**
 * Convert PrintOrderData to EditablePrintData for frontend modal
 */
export function toEditablePrintData(data: PrintOrderData): EditablePrintData {
  const { order, business, customer, outlet } = data;
  const { date, time } = formatDateTime(order.created_at, business.timezone);
  const items = order.items as OrderItemData[];

  // Calculate subtotal
  let subtotal = 0;
  const editableItems: EditablePrintItem[] = items.map(item => {
    const itemTotal = item.line_total || (item.unit_price || 0) * item.quantity;
    subtotal += itemTotal;

    const editableItem: EditablePrintItem = {
      name: item.name,
      quantity: item.quantity,
      size_or_weight: item.size_or_weight,
      unit_price: item.unit_price,
      line_total: itemTotal,
      custom_text: item.custom_text,
      delivery_date: item.delivery_date,
      notes: item.notes,
    };

    if (item.addons && item.addons.length > 0) {
      editableItem.addons = item.addons.map(addon => {
        const addonTotal = addon.line_total || (addon.unit_price || 0) * addon.quantity;
        subtotal += addonTotal;
        return {
          addon_name: addon.addon_name,
          quantity: addon.quantity,
          unit_price: addon.unit_price,
          line_total: addonTotal,
        };
      });
    }

    return editableItem;
  });

  return {
    order_number: order.order_number,
    order_date: date,
    order_time: time,
    business_name: business.name,
    customer_name: customer.name || 'Walk-in',
    customer_phone: customer.phone,
    items: editableItems,
    subtotal,
    delivery_fee: order.delivery_fee || 0,
    grand_total: order.total_amount,
    fulfillment_type: order.fulfillment_type || 'takeaway',
    delivery_address: order.delivery_address || undefined,
    delivery_latitude: order.delivery_latitude || undefined,
    delivery_longitude: order.delivery_longitude || undefined,
    delivery_time: order.delivery_time || undefined,
    outlet_name: outlet?.outlet_name,
    outlet_address: outlet?.address,
    pickup_time: order.pickup_time || undefined,
    sp_note: order.fulfillment_notes || undefined,
  };
}

/**
 * Get outlet by ID with printer IP
 */
export async function getOutletWithPrinter(outletId: string): Promise<BusinessOutlet | null> {
  const { data, error } = await supabase
    .from('business_outlets')
    .select('*')
    .eq('id', outletId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as BusinessOutlet;
}

/**
 * Format date/time for receipt
 */
function formatDateTime(isoString: string, timezone?: string): { date: string; time: string } {
  const date = new Date(isoString);
  const tz = timezone || 'Asia/Kolkata';

  const dateStr = date.toLocaleDateString('en-IN', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const timeStr = date.toLocaleTimeString('en-IN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  return { date: dateStr, time: timeStr };
}

/**
 * Pad string to fixed width (for alignment)
 */
function padString(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  if (str.length >= width) return str.substring(0, width);

  const padding = width - str.length;
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center':
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
    default:
      return str + ' '.repeat(padding);
  }
}

/**
 * Format a line with left and right aligned text
 */
function formatLine(left: string, right: string, width: number = PAPER_WIDTH): string {
  const maxLeft = width - right.length - 1;
  const truncatedLeft = left.length > maxLeft ? left.substring(0, maxLeft) : left;
  const padding = width - truncatedLeft.length - right.length;
  return truncatedLeft + ' '.repeat(Math.max(1, padding)) + right;
}

/**
 * Generate ESC/POS commands for thermal printer
 */
export function generateEscPosReceipt(data: PrintOrderData): Buffer {
  const { order, business, customer, outlet } = data;
  const { date, time } = formatDateTime(order.created_at, business.timezone);
  const items = order.items as OrderItemData[];

  let receipt = '';

  // Initialize printer
  receipt += ESCPOS.INIT;

  // Header - Business name (large, centered, bold)
  receipt += ESCPOS.ALIGN_CENTER;
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_SIZE;
  receipt += business.name.toUpperCase() + '\n';
  receipt += ESCPOS.NORMAL_SIZE;

  // Order number
  receipt += ESCPOS.DOUBLE_HEIGHT;
  receipt += `KOT #${order.order_number}\n`;
  receipt += ESCPOS.NORMAL_SIZE;
  receipt += ESCPOS.BOLD_OFF;

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Date/Time line
  receipt += ESCPOS.ALIGN_LEFT;
  receipt += formatLine(`Date: ${date}`, `Time: ${time}`) + '\n';
  receipt += ESCPOS.LINE + '\n';

  // Customer info
  const customerName = customer.name || 'Walk-in';
  receipt += `Customer: ${customerName}\n`;
  receipt += `Phone: ${customer.phone}\n`;
  receipt += ESCPOS.LINE + '\n';

  // Items section
  receipt += ESCPOS.BOLD_ON;
  receipt += 'ITEMS:\n';
  receipt += ESCPOS.BOLD_OFF;
  receipt += ESCPOS.LINE + '\n';

  let subtotal = 0;

  items.forEach((item, index) => {
    const itemTotal = item.line_total || (item.unit_price || 0) * item.quantity;
    subtotal += itemTotal;

    // Item line: "1x Chocolate Cake (1kg)    ₹850"
    let itemDesc = `${item.quantity}x ${item.name}`;
    if (item.size_or_weight) {
      itemDesc += ` (${item.size_or_weight})`;
    }

    const priceStr = itemTotal > 0 ? `₹${itemTotal}` : '';
    receipt += formatLine(itemDesc, priceStr) + '\n';

    // Add-ons
    if (item.addons && item.addons.length > 0) {
      item.addons.forEach(addon => {
        const addonTotal = addon.line_total || (addon.unit_price || 0) * addon.quantity;
        subtotal += addonTotal;

        let addonDesc = `   + ${addon.addon_name}`;
        if (addon.quantity > 1) {
          addonDesc += ` x${addon.quantity}`;
        }
        const addonPrice = addonTotal > 0 ? `₹${addonTotal}` : 'FREE';
        receipt += formatLine(addonDesc, addonPrice) + '\n';
      });
    }

    // Custom text (cake message)
    if (item.custom_text) {
      receipt += `   "${item.custom_text}"\n`;
    }

    // Delivery date
    if (item.delivery_date) {
      receipt += `   Date: ${item.delivery_date}\n`;
    }

    // Notes
    if (item.notes) {
      receipt += `   Note: ${item.notes}\n`;
    }
  });

  receipt += ESCPOS.LINE + '\n';

  // Totals
  receipt += formatLine('Subtotal:', `₹${subtotal}`) + '\n';

  if (order.delivery_fee && order.delivery_fee > 0) {
    receipt += formatLine('Delivery Fee:', `₹${order.delivery_fee}`) + '\n';
  }

  receipt += ESCPOS.LINE + '\n';
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_HEIGHT;
  receipt += formatLine('GRAND TOTAL:', `₹${order.total_amount}`) + '\n';
  receipt += ESCPOS.NORMAL_SIZE;
  receipt += ESCPOS.BOLD_OFF;

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Fulfillment section
  receipt += '\n';
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.ALIGN_CENTER;

  if (order.fulfillment_type === 'delivery') {
    receipt += '🚚 DELIVERY\n';
  } else {
    receipt += '🏪 TAKEAWAY\n';
  }

  receipt += ESCPOS.BOLD_OFF;
  receipt += ESCPOS.ALIGN_LEFT;
  receipt += ESCPOS.LINE + '\n';

  if (order.fulfillment_type === 'delivery') {
    if (order.delivery_address) {
      // Split long address into multiple lines
      const address = order.delivery_address;
      const words = address.split(' ');
      let line = 'Address: ';

      words.forEach((word, i) => {
        if ((line + word).length > PAPER_WIDTH - 2) {
          receipt += line + '\n';
          line = '  ' + word + ' ';
        } else {
          line += word + ' ';
        }
      });
      if (line.trim()) {
        receipt += line.trim() + '\n';
      }
    }

    if (order.delivery_time) {
      receipt += `Time: ${order.delivery_time}\n`;
    }
  } else {
    // Takeaway - show outlet
    if (outlet) {
      receipt += `Outlet: ${outlet.outlet_name}\n`;
      receipt += `Address: ${outlet.address}\n`;
    }

    if (order.pickup_time) {
      receipt += `Pickup: ${order.pickup_time}\n`;
    }
  }

  // Fulfillment notes
  if (order.fulfillment_notes) {
    receipt += ESCPOS.LINE + '\n';
    receipt += ESCPOS.BOLD_ON;
    receipt += 'Sp Note:\n';
    receipt += ESCPOS.BOLD_OFF;
    receipt += order.fulfillment_notes + '\n';
  }

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Footer
  receipt += ESCPOS.ALIGN_CENTER;
  receipt += 'Thank you for ordering!\n';
  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Feed and cut
  receipt += ESCPOS.FEED_LINES(4);
  receipt += ESCPOS.CUT_PARTIAL;

  return Buffer.from(receipt, 'binary');
}

/**
 * Generate HTML preview of receipt (for testing without printer)
 */
export function generateHtmlPreview(data: PrintOrderData): string {
  const { order, business, customer, outlet } = data;
  const { date, time } = formatDateTime(order.created_at, business.timezone);
  const items = order.items as OrderItemData[];

  let subtotal = 0;

  // Calculate subtotal
  items.forEach(item => {
    subtotal += item.line_total || (item.unit_price || 0) * item.quantity;
    if (item.addons) {
      item.addons.forEach(addon => {
        subtotal += addon.line_total || (addon.unit_price || 0) * addon.quantity;
      });
    }
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>KOT #${order.order_number}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Courier New', monospace;
      background: #f5f5f5;
      padding: 20px;
      display: flex;
      justify-content: center;
    }
    .receipt {
      width: 302px; /* 80mm at 96dpi */
      background: white;
      padding: 15px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      font-size: 12px;
      line-height: 1.4;
    }
    .header {
      text-align: center;
      margin-bottom: 10px;
    }
    .business-name {
      font-size: 18px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .order-number {
      font-size: 16px;
      font-weight: bold;
    }
    .divider {
      border-top: 1px dashed #333;
      margin: 8px 0;
    }
    .double-divider {
      border-top: 2px solid #333;
      margin: 8px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .section-title {
      font-weight: bold;
      margin: 5px 0;
    }
    .item {
      margin: 5px 0;
    }
    .item-main {
      display: flex;
      justify-content: space-between;
    }
    .item-addon {
      margin-left: 15px;
      font-size: 11px;
      color: #555;
    }
    .item-note {
      margin-left: 15px;
      font-size: 11px;
      font-style: italic;
      color: #666;
    }
    .total-row {
      font-weight: bold;
      font-size: 14px;
    }
    .fulfillment {
      text-align: center;
      margin: 10px 0;
    }
    .fulfillment-type {
      font-size: 14px;
      font-weight: bold;
      padding: 5px;
      background: #f0f0f0;
      border-radius: 4px;
    }
    .fulfillment-details {
      text-align: left;
      margin-top: 8px;
    }
    .address {
      word-wrap: break-word;
    }
    .footer {
      text-align: center;
      margin-top: 10px;
      font-size: 11px;
    }
    .sp-note {
      background: #fff3cd;
      padding: 5px;
      margin: 5px 0;
      border-radius: 4px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .receipt {
        box-shadow: none;
        width: 80mm;
      }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="business-name">${escapeHtml(business.name)}</div>
      <div class="order-number">KOT #${escapeHtml(order.order_number)}</div>
    </div>

    <div class="double-divider"></div>

    <div class="row">
      <span>Date: ${date}</span>
      <span>Time: ${time}</span>
    </div>

    <div class="divider"></div>

    <div>Customer: ${escapeHtml(customer.name || 'Walk-in')}</div>
    <div>Phone: ${escapeHtml(customer.phone)}</div>

    <div class="divider"></div>

    <div class="section-title">ITEMS:</div>
    <div class="divider"></div>

    ${items.map(item => {
      const itemTotal = item.line_total || (item.unit_price || 0) * item.quantity;
      let itemHtml = `
        <div class="item">
          <div class="item-main">
            <span>${item.quantity}x ${escapeHtml(item.name)}${item.size_or_weight ? ` (${escapeHtml(item.size_or_weight)})` : ''}</span>
            <span>${itemTotal > 0 ? `₹${itemTotal}` : ''}</span>
          </div>
      `;

      if (item.addons && item.addons.length > 0) {
        item.addons.forEach(addon => {
          const addonTotal = addon.line_total || (addon.unit_price || 0) * addon.quantity;
          itemHtml += `
            <div class="item-addon">
              <span>+ ${escapeHtml(addon.addon_name)}${addon.quantity > 1 ? ` x${addon.quantity}` : ''}</span>
              <span style="float:right">${addonTotal > 0 ? `₹${addonTotal}` : 'FREE'}</span>
            </div>
          `;
        });
      }

      if (item.custom_text) {
        itemHtml += `<div class="item-note">"${escapeHtml(item.custom_text)}"</div>`;
      }

      if (item.delivery_date) {
        itemHtml += `<div class="item-note">Date: ${escapeHtml(item.delivery_date)}</div>`;
      }

      if (item.notes) {
        itemHtml += `<div class="item-note">Note: ${escapeHtml(item.notes)}</div>`;
      }

      itemHtml += '</div>';
      return itemHtml;
    }).join('')}

    <div class="divider"></div>

    <div class="row">
      <span>Subtotal:</span>
      <span>₹${subtotal}</span>
    </div>

    ${order.delivery_fee && order.delivery_fee > 0 ? `
      <div class="row">
        <span>Delivery Fee:</span>
        <span>₹${order.delivery_fee}</span>
      </div>
    ` : ''}

    <div class="divider"></div>

    <div class="row total-row">
      <span>GRAND TOTAL:</span>
      <span>₹${order.total_amount}</span>
    </div>

    <div class="double-divider"></div>

    <div class="fulfillment">
      <div class="fulfillment-type">
        ${order.fulfillment_type === 'delivery' ? '🚚 DELIVERY' : '🏪 TAKEAWAY'}
      </div>
    </div>

    <div class="divider"></div>

    <div class="fulfillment-details">
      ${order.fulfillment_type === 'delivery' ? `
        ${order.delivery_address ? `<div class="address"><strong>Address:</strong> ${escapeHtml(order.delivery_address)}</div>` : ''}
        ${order.delivery_time ? `<div><strong>Time:</strong> ${escapeHtml(order.delivery_time)}</div>` : ''}
      ` : `
        ${outlet ? `
          <div><strong>Outlet:</strong> ${escapeHtml(outlet.outlet_name)}</div>
          <div><strong>Address:</strong> ${escapeHtml(outlet.address)}</div>
        ` : ''}
        ${order.pickup_time ? `<div><strong>Pickup:</strong> ${escapeHtml(order.pickup_time)}</div>` : ''}
      `}
    </div>

    ${order.fulfillment_notes ? `
      <div class="divider"></div>
      <div class="sp-note">
        <strong>Sp Note:</strong> ${escapeHtml(order.fulfillment_notes)}
      </div>
    ` : ''}

    <div class="double-divider"></div>

    <div class="footer">
      Thank you for ordering!
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate ESC/POS commands from editable print data
 */
export function generateEscPosFromEditable(data: EditablePrintData): Buffer {
  let receipt = '';

  // Initialize printer
  receipt += ESCPOS.INIT;

  // Header - Business name (large, centered, bold)
  receipt += ESCPOS.ALIGN_CENTER;
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_SIZE;
  receipt += data.business_name.toUpperCase() + '\n';
  receipt += ESCPOS.NORMAL_SIZE;

  // Order number
  receipt += ESCPOS.DOUBLE_HEIGHT;
  receipt += `KOT #${data.order_number}\n`;
  receipt += ESCPOS.NORMAL_SIZE;
  receipt += ESCPOS.BOLD_OFF;

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Date/Time line
  receipt += ESCPOS.ALIGN_LEFT;
  receipt += formatLine(`Date: ${data.order_date}`, `Time: ${data.order_time}`) + '\n';
  receipt += ESCPOS.LINE + '\n';

  // Customer info
  receipt += `Customer: ${data.customer_name}\n`;
  receipt += `Phone: ${data.customer_phone}\n`;
  receipt += ESCPOS.LINE + '\n';

  // Items section
  receipt += ESCPOS.BOLD_ON;
  receipt += 'ITEMS:\n';
  receipt += ESCPOS.BOLD_OFF;
  receipt += ESCPOS.LINE + '\n';

  data.items.forEach((item) => {
    // Item line
    let itemDesc = `${item.quantity}x ${item.name}`;
    if (item.size_or_weight) {
      itemDesc += ` (${item.size_or_weight})`;
    }

    const priceStr = item.line_total && item.line_total > 0 ? `₹${item.line_total}` : '';
    receipt += formatLine(itemDesc, priceStr) + '\n';

    // Add-ons
    if (item.addons && item.addons.length > 0) {
      item.addons.forEach(addon => {
        let addonDesc = `   + ${addon.addon_name}`;
        if (addon.quantity > 1) {
          addonDesc += ` x${addon.quantity}`;
        }
        const addonPrice = addon.line_total && addon.line_total > 0 ? `₹${addon.line_total}` : 'FREE';
        receipt += formatLine(addonDesc, addonPrice) + '\n';
      });
    }

    // Custom text (cake message)
    if (item.custom_text) {
      receipt += `   "${item.custom_text}"\n`;
    }

    // Delivery date
    if (item.delivery_date) {
      receipt += `   Date: ${item.delivery_date}\n`;
    }

    // Notes
    if (item.notes) {
      receipt += `   Note: ${item.notes}\n`;
    }
  });

  receipt += ESCPOS.LINE + '\n';

  // Totals
  receipt += formatLine('Subtotal:', `₹${data.subtotal}`) + '\n';

  if (data.delivery_fee > 0) {
    receipt += formatLine('Delivery Fee:', `₹${data.delivery_fee}`) + '\n';
  }

  receipt += ESCPOS.LINE + '\n';
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.DOUBLE_HEIGHT;
  receipt += formatLine('GRAND TOTAL:', `₹${data.grand_total}`) + '\n';
  receipt += ESCPOS.NORMAL_SIZE;
  receipt += ESCPOS.BOLD_OFF;

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Fulfillment section
  receipt += '\n';
  receipt += ESCPOS.BOLD_ON;
  receipt += ESCPOS.ALIGN_CENTER;

  if (data.fulfillment_type === 'delivery') {
    receipt += '🚚 DELIVERY\n';
  } else {
    receipt += '🏪 TAKEAWAY\n';
  }

  receipt += ESCPOS.BOLD_OFF;
  receipt += ESCPOS.ALIGN_LEFT;
  receipt += ESCPOS.LINE + '\n';

  if (data.fulfillment_type === 'delivery') {
    if (data.delivery_address) {
      const words = data.delivery_address.split(' ');
      let line = 'Address: ';

      words.forEach((word) => {
        if ((line + word).length > PAPER_WIDTH - 2) {
          receipt += line + '\n';
          line = '  ' + word + ' ';
        } else {
          line += word + ' ';
        }
      });
      if (line.trim()) {
        receipt += line.trim() + '\n';
      }
    }

    if (data.delivery_time) {
      receipt += `Time: ${data.delivery_time}\n`;
    }

    // QR Code for location (if lat/lng available)
    if (isValidCoordinates(data.delivery_latitude, data.delivery_longitude)) {
      const mapsLink = generateGoogleMapsLink(data.delivery_latitude, data.delivery_longitude);
      if (mapsLink) {
        receipt += '\n';
        receipt += ESCPOS.ALIGN_CENTER;
        receipt += 'Scan for Location:\n';
        receipt += generateQRCodeCommand(mapsLink, 6);
        receipt += '\n';
        receipt += ESCPOS.ALIGN_LEFT;
      }
    }
  } else {
    if (data.outlet_name) {
      receipt += `Outlet: ${data.outlet_name}\n`;
    }
    if (data.outlet_address) {
      receipt += `Address: ${data.outlet_address}\n`;
    }
    if (data.pickup_time) {
      receipt += `Pickup: ${data.pickup_time}\n`;
    }
  }

  // Special note
  if (data.sp_note) {
    receipt += ESCPOS.LINE + '\n';
    receipt += ESCPOS.BOLD_ON;
    receipt += 'Sp Note:\n';
    receipt += ESCPOS.BOLD_OFF;
    receipt += data.sp_note + '\n';
  }

  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Footer
  receipt += ESCPOS.ALIGN_CENTER;
  receipt += 'Thank you for ordering!\n';
  receipt += ESCPOS.DOUBLE_LINE + '\n';

  // Feed and cut
  receipt += ESCPOS.FEED_LINES(4);
  receipt += ESCPOS.CUT_PARTIAL;

  return Buffer.from(receipt, 'binary');
}

/**
 * Generate HTML preview from editable print data
 */
export function generateHtmlFromEditable(data: EditablePrintData): string {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>KOT #${data.order_number}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Courier New', monospace;
      background: #f5f5f5;
      padding: 20px;
      display: flex;
      justify-content: center;
    }
    .receipt {
      width: 302px;
      background: white;
      padding: 15px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      font-size: 12px;
      line-height: 1.4;
    }
    .header {
      text-align: center;
      margin-bottom: 10px;
    }
    .business-name {
      font-size: 18px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .order-number {
      font-size: 16px;
      font-weight: bold;
    }
    .divider {
      border-top: 1px dashed #333;
      margin: 8px 0;
    }
    .double-divider {
      border-top: 2px solid #333;
      margin: 8px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .section-title {
      font-weight: bold;
      margin: 5px 0;
    }
    .item {
      margin: 5px 0;
    }
    .item-main {
      display: flex;
      justify-content: space-between;
    }
    .item-addon {
      margin-left: 15px;
      font-size: 11px;
      color: #555;
    }
    .item-note {
      margin-left: 15px;
      font-size: 11px;
      font-style: italic;
      color: #666;
    }
    .total-row {
      font-weight: bold;
      font-size: 14px;
    }
    .fulfillment {
      text-align: center;
      margin: 10px 0;
    }
    .fulfillment-type {
      font-size: 14px;
      font-weight: bold;
      padding: 5px;
      background: #f0f0f0;
      border-radius: 4px;
    }
    .fulfillment-details {
      text-align: left;
      margin-top: 8px;
    }
    .address {
      word-wrap: break-word;
    }
    .footer {
      text-align: center;
      margin-top: 10px;
      font-size: 11px;
    }
    .sp-note {
      background: #fff3cd;
      padding: 5px;
      margin: 5px 0;
      border-radius: 4px;
    }
    .qr-section {
      text-align: center;
      margin: 10px 0;
      padding: 10px;
      background: #f9f9f9;
      border-radius: 4px;
    }
    .qr-section img {
      display: block;
      margin: 5px auto;
    }
    .qr-label {
      font-size: 10px;
      color: #666;
      margin-bottom: 5px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .receipt {
        box-shadow: none;
        width: 80mm;
      }
    }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <div class="business-name">${escapeHtml(data.business_name)}</div>
      <div class="order-number">KOT #${escapeHtml(data.order_number)}</div>
    </div>

    <div class="double-divider"></div>

    <div class="row">
      <span>Date: ${escapeHtml(data.order_date)}</span>
      <span>Time: ${escapeHtml(data.order_time)}</span>
    </div>

    <div class="divider"></div>

    <div>Customer: ${escapeHtml(data.customer_name)}</div>
    <div>Phone: ${escapeHtml(data.customer_phone)}</div>

    <div class="divider"></div>

    <div class="section-title">ITEMS:</div>
    <div class="divider"></div>

    ${data.items.map(item => {
      let itemHtml = `
        <div class="item">
          <div class="item-main">
            <span>${item.quantity}x ${escapeHtml(item.name)}${item.size_or_weight ? ` (${escapeHtml(item.size_or_weight)})` : ''}</span>
            <span>${item.line_total && item.line_total > 0 ? `₹${item.line_total}` : ''}</span>
          </div>
      `;

      if (item.addons && item.addons.length > 0) {
        item.addons.forEach(addon => {
          itemHtml += `
            <div class="item-addon">
              <span>+ ${escapeHtml(addon.addon_name)}${addon.quantity > 1 ? ` x${addon.quantity}` : ''}</span>
              <span style="float:right">${addon.line_total && addon.line_total > 0 ? `₹${addon.line_total}` : 'FREE'}</span>
            </div>
          `;
        });
      }

      if (item.custom_text) {
        itemHtml += `<div class="item-note">"${escapeHtml(item.custom_text)}"</div>`;
      }

      if (item.delivery_date) {
        itemHtml += `<div class="item-note">Date: ${escapeHtml(item.delivery_date)}</div>`;
      }

      if (item.notes) {
        itemHtml += `<div class="item-note">Note: ${escapeHtml(item.notes)}</div>`;
      }

      itemHtml += '</div>';
      return itemHtml;
    }).join('')}

    <div class="divider"></div>

    <div class="row">
      <span>Subtotal:</span>
      <span>₹${data.subtotal}</span>
    </div>

    ${data.delivery_fee > 0 ? `
      <div class="row">
        <span>Delivery Fee:</span>
        <span>₹${data.delivery_fee}</span>
      </div>
    ` : ''}

    <div class="divider"></div>

    <div class="row total-row">
      <span>GRAND TOTAL:</span>
      <span>₹${data.grand_total}</span>
    </div>

    <div class="double-divider"></div>

    <div class="fulfillment">
      <div class="fulfillment-type">
        ${data.fulfillment_type === 'delivery' ? '🚚 DELIVERY' : '🏪 TAKEAWAY'}
      </div>
    </div>

    <div class="divider"></div>

    <div class="fulfillment-details">
      ${data.fulfillment_type === 'delivery' ? `
        ${data.delivery_address ? `<div class="address"><strong>Address:</strong> ${escapeHtml(data.delivery_address)}</div>` : ''}
        ${data.delivery_time ? `<div><strong>Time:</strong> ${escapeHtml(data.delivery_time)}</div>` : ''}
        ${isValidCoordinates(data.delivery_latitude, data.delivery_longitude) ? `
          <div class="qr-section">
            <div class="qr-label">Scan for Location</div>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(generateGoogleMapsLink(data.delivery_latitude, data.delivery_longitude) || '')}" alt="Location QR" width="120" height="120" />
          </div>
        ` : ''}
      ` : `
        ${data.outlet_name ? `<div><strong>Outlet:</strong> ${escapeHtml(data.outlet_name)}</div>` : ''}
        ${data.outlet_address ? `<div><strong>Address:</strong> ${escapeHtml(data.outlet_address)}</div>` : ''}
        ${data.pickup_time ? `<div><strong>Pickup:</strong> ${escapeHtml(data.pickup_time)}</div>` : ''}
      `}
    </div>

    ${data.sp_note ? `
      <div class="divider"></div>
      <div class="sp-note">
        <strong>Sp Note:</strong> ${escapeHtml(data.sp_note)}
      </div>
    ` : ''}

    <div class="double-divider"></div>

    <div class="footer">
      Thank you for ordering!
    </div>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Send data to thermal printer via TCP socket
 */
export async function sendToPrinter(printerIp: string, data: Buffer, port: number = 9100): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    // Set timeout
    client.setTimeout(10000);

    client.connect(port, printerIp, () => {
      logger.info(`Connected to printer at ${printerIp}:${port}`);

      client.write(data, (err) => {
        if (err) {
          logger.error('Failed to write to printer', err);
          client.destroy();
          reject(err);
          return;
        }

        logger.info('Data sent to printer successfully');
        client.end();
        resolve(true);
      });
    });

    client.on('timeout', () => {
      logger.error('Printer connection timeout');
      client.destroy();
      reject(new Error('Connection timeout'));
    });

    client.on('error', (err) => {
      logger.error('Printer connection error', err);
      client.destroy();
      reject(err);
    });

    client.on('close', () => {
      logger.info('Printer connection closed');
    });
  });
}

/**
 * Print an order to thermal printer
 */
export async function printOrder(orderId: string, outletId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Get order data
    const printData = await getOrderPrintData(orderId);
    if (!printData) {
      return { success: false, error: 'Order not found' };
    }

    // Get outlet with printer IP
    const outlet = await getOutletWithPrinter(outletId);
    if (!outlet) {
      return { success: false, error: 'Outlet not found' };
    }

    if (!outlet.printer_ip) {
      return { success: false, error: 'No printer configured for this outlet' };
    }

    // Generate receipt
    const receiptData = generateEscPosReceipt(printData);

    // Send to printer
    await sendToPrinter(outlet.printer_ip, receiptData);

    logger.info(`Order ${orderId} printed successfully to ${outlet.printer_ip}`);
    return { success: true };

  } catch (error) {
    logger.error('Print failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Print failed'
    };
  }
}

/**
 * Print from editable data (with admin modifications)
 */
export async function printFromEditable(
  editableData: EditablePrintData,
  printerIp: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate receipt from editable data
    const receiptData = generateEscPosFromEditable(editableData);

    // Send to printer
    await sendToPrinter(printerIp, receiptData);

    logger.info(`Order ${editableData.order_number} printed successfully to ${printerIp}`);
    return { success: true };

  } catch (error) {
    logger.error('Print failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Print failed'
    };
  }
}
