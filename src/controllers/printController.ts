import { Response } from 'express';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  getOrderPrintData,
  generateHtmlPreview,
  printOrder,
  getOutletWithPrinter,
  toEditablePrintData,
  generateHtmlFromEditable,
  printFromEditable,
  generateEscPosFromEditable,
  EditablePrintData,
} from '../services/printService';
import { supabase } from '../config/database';
import {
  isProxyConnected,
  sendPrintJob,
  getProxyStatus,
  getConnectedProxies,
} from '../services/printProxyService';

/**
 * GET /api/print/preview/:orderId
 * Returns HTML preview of receipt (for testing without printer)
 */
export async function getReceiptPreview(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;

    // Verify order belongs to this business
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, business_id')
      .eq('id', orderId)
      .eq('business_id', businessId)
      .single();

    if (orderError || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Get print data
    const printData = await getOrderPrintData(orderId);
    if (!printData) {
      res.status(404).json({ error: 'Failed to load order data' });
      return;
    }

    // Generate HTML preview
    const html = generateHtmlPreview(printData);

    // Return HTML
    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    logger.error('Failed to generate receipt preview', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
}

/**
 * GET /api/print/data/:orderId
 * Returns editable JSON data for print modal
 */
export async function getPrintData(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;

    // Verify order belongs to this business
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, business_id')
      .eq('id', orderId)
      .eq('business_id', businessId)
      .single();

    if (orderError || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Get print data
    const printData = await getOrderPrintData(orderId);
    if (!printData) {
      res.status(404).json({ error: 'Failed to load order data' });
      return;
    }

    // Convert to editable format
    const editableData = toEditablePrintData(printData);

    // Get outlets with printers for selection
    const { data: outlets } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, printer_ip')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .not('printer_ip', 'is', null)
      .order('display_order', { ascending: true });

    res.status(200).json({
      printData: editableData,
      outlets: (outlets || []).map(o => ({
        id: o.id,
        outlet_name: o.outlet_name,
        printer_ip: o.printer_ip,
      })),
    });

  } catch (error) {
    logger.error('Failed to get print data', error);
    res.status(500).json({ error: 'Failed to get print data' });
  }
}

/**
 * POST /api/print/preview
 * Returns HTML preview from edited data (for modal preview)
 * Body: EditablePrintData
 */
export async function getEditedPreview(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const editableData: EditablePrintData = req.body;

    if (!editableData || !editableData.order_number) {
      res.status(400).json({ error: 'Invalid print data' });
      return;
    }

    // Generate HTML preview from edited data
    const html = generateHtmlFromEditable(editableData);

    // Return HTML
    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    logger.error('Failed to generate edited preview', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
}

/**
 * POST /api/print/:orderId
 * Print order to thermal printer with optional edits
 * Body: { outletId: string, printData?: EditablePrintData }
 */
export async function printOrderReceipt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;
    const { outletId, printData } = req.body;

    if (!outletId) {
      res.status(400).json({ error: 'outletId is required' });
      return;
    }

    // Verify order belongs to this business
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, business_id, order_number')
      .eq('id', orderId)
      .eq('business_id', businessId)
      .single();

    if (orderError || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Verify outlet belongs to this business
    const { data: outlet, error: outletError } = await supabase
      .from('business_outlets')
      .select('id, business_id, outlet_name, printer_ip')
      .eq('id', outletId)
      .eq('business_id', businessId)
      .single();

    if (outletError || !outlet) {
      res.status(404).json({ error: 'Outlet not found' });
      return;
    }

    if (!outlet.printer_ip) {
      res.status(400).json({ error: 'No printer configured for this outlet' });
      return;
    }

    let result: { success: boolean; error?: string };

    // Check if print proxy is connected for this outlet
    const proxyConnected = isProxyConnected(outletId);

    if (proxyConnected) {
      // Use print proxy (for cloud deployment)
      logger.info(`Using print proxy for outlet ${outlet.outlet_name}`);

      // Get or generate editable print data
      let editableData: EditablePrintData;

      if (printData) {
        editableData = printData as EditablePrintData;
      } else {
        const orderPrintData = await getOrderPrintData(orderId);
        if (!orderPrintData) {
          res.status(404).json({ error: 'Failed to load order data' });
          return;
        }
        editableData = toEditablePrintData(orderPrintData);
      }

      // Generate ESC/POS data and convert to base64
      const escPosBuffer = generateEscPosFromEditable(editableData);
      const base64Data = escPosBuffer.toString('base64');

      // Generate unique job ID
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Send via proxy
      result = await sendPrintJob(outletId, {
        id: jobId,
        data: base64Data,
        printerIp: outlet.printer_ip,
        timestamp: Date.now(),
      });

    } else {
      // Direct TCP connection (for local development or same-network deployment)
      logger.info(`Using direct TCP for outlet ${outlet.outlet_name} (proxy not connected)`);

      if (printData) {
        result = await printFromEditable(printData as EditablePrintData, outlet.printer_ip);
      } else {
        result = await printOrder(orderId, outletId);
      }
    }

    if (result.success) {
      logger.info(`Order ${order.order_number} printed to ${outlet.outlet_name} (via ${proxyConnected ? 'proxy' : 'direct'})`);
      res.status(200).json({
        success: true,
        message: `Order printed successfully to ${outlet.outlet_name}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Print failed',
      });
    }

  } catch (error) {
    logger.error('Failed to print order', error);
    res.status(500).json({ error: 'Failed to print order' });
  }
}

/**
 * GET /api/print/outlets
 * Get outlets with printer configuration status
 */
export async function getOutletsWithPrinterStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: outlets, error } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, address, printer_ip')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'Failed to fetch outlets' });
      return;
    }

    // Add printer status
    const outletsWithStatus = (outlets || []).map(outlet => ({
      id: outlet.id,
      outlet_name: outlet.outlet_name,
      address: outlet.address,
      printer_ip: outlet.printer_ip,
      has_printer: !!outlet.printer_ip,
    }));

    res.status(200).json({ outlets: outletsWithStatus });

  } catch (error) {
    logger.error('Failed to fetch outlets with printer status', error);
    res.status(500).json({ error: 'Failed to fetch outlets' });
  }
}

/**
 * PATCH /api/print/outlets/:outletId/printer
 * Update printer IP for an outlet
 * Body: { printer_ip: string | null }
 */
export async function updateOutletPrinter(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { outletId } = req.params;
    const { printer_ip } = req.body;

    // Validate IP format if provided
    if (printer_ip && !isValidIpAddress(printer_ip)) {
      res.status(400).json({ error: 'Invalid IP address format' });
      return;
    }

    // Verify outlet belongs to this business
    const { data: outlet, error: outletError } = await supabase
      .from('business_outlets')
      .select('id')
      .eq('id', outletId)
      .eq('business_id', businessId)
      .single();

    if (outletError || !outlet) {
      res.status(404).json({ error: 'Outlet not found' });
      return;
    }

    // Update printer IP
    const { error: updateError } = await supabase
      .from('business_outlets')
      .update({
        printer_ip: printer_ip || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', outletId);

    if (updateError) {
      res.status(500).json({ error: 'Failed to update printer IP' });
      return;
    }

    logger.info(`Printer IP updated for outlet ${outletId}: ${printer_ip || 'removed'}`);
    res.status(200).json({
      success: true,
      message: printer_ip ? `Printer IP set to ${printer_ip}` : 'Printer removed',
    });

  } catch (error) {
    logger.error('Failed to update outlet printer', error);
    res.status(500).json({ error: 'Failed to update printer' });
  }
}

/**
 * Validate IP address format (IPv4)
 */
function isValidIpAddress(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) return false;

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * GET /api/print/proxy-status
 * Get print proxy connection status for all outlets
 */
export async function getProxyConnectionStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get all outlets with printers for this business
    const { data: outlets, error } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, printer_ip')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .not('printer_ip', 'is', null);

    if (error) {
      res.status(500).json({ error: 'Failed to fetch outlets' });
      return;
    }

    // Get proxy status for each outlet
    const outletsWithProxyStatus = (outlets || []).map(outlet => {
      const status = getProxyStatus(outlet.id);
      return {
        id: outlet.id,
        outlet_name: outlet.outlet_name,
        printer_ip: outlet.printer_ip,
        proxy_connected: status.connected,
        last_ping: status.lastPing || null,
      };
    });

    // Get all connected proxies for this business
    const connectedProxies = getConnectedProxies(businessId);

    res.status(200).json({
      outlets: outletsWithProxyStatus,
      total_connected: connectedProxies.length,
    });

  } catch (error) {
    logger.error('Failed to get proxy status', error);
    res.status(500).json({ error: 'Failed to get proxy status' });
  }
}

/**
 * GET /api/print/proxy-status/:outletId
 * Get print proxy connection status for a specific outlet
 */
export async function getOutletProxyStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { outletId } = req.params;

    // Verify outlet belongs to this business
    const { data: outlet, error } = await supabase
      .from('business_outlets')
      .select('id, outlet_name, printer_ip')
      .eq('id', outletId)
      .eq('business_id', businessId)
      .single();

    if (error || !outlet) {
      res.status(404).json({ error: 'Outlet not found' });
      return;
    }

    const status = getProxyStatus(outletId);

    res.status(200).json({
      outlet_id: outlet.id,
      outlet_name: outlet.outlet_name,
      printer_ip: outlet.printer_ip,
      proxy_connected: status.connected,
      last_ping: status.lastPing || null,
    });

  } catch (error) {
    logger.error('Failed to get outlet proxy status', error);
    res.status(500).json({ error: 'Failed to get outlet proxy status' });
  }
}
