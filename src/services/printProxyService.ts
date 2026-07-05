import { Server as HTTPServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../utils/logger';
import { supabase } from '../config/database';
import { URL } from 'url';

interface PrintProxyClient {
  ws: WebSocket;
  outletId: string;
  businessId: string;
  lastPing: number;
  isAlive: boolean;
}

interface PrintJob {
  id: string;
  data: string; // Base64 encoded ESC/POS data
  printerIp: string;
  timestamp: number;
}

interface PrintAck {
  jobId: string;
  success: boolean;
  error?: string;
}

// Connected print proxy clients (keyed by outletId)
const clients: Map<string, PrintProxyClient> = new Map();

// Pending print jobs waiting for acknowledgment
const pendingJobs: Map<string, {
  resolve: (value: { success: boolean; error?: string }) => void;
  timeout: NodeJS.Timeout;
}> = new Map();

let wss: WebSocketServer | null = null;

/**
 * Initialize Print Proxy WebSocket server
 */
export function initializePrintProxyWebSocket(server: HTTPServer): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const pathname = request.url ? request.url.split('?')[0] : '';
    if (pathname === '/ws/print-proxy') {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    try {
      // Parse outlet ID from query string
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const outletId = url.searchParams.get('outletId');

      if (!outletId) {
        logger.warn('Print proxy connection without outletId');
        ws.close(1008, 'Missing outletId');
        return;
      }

      // Verify outlet exists and get business ID
      const { data: outlet, error } = await supabase
        .from('business_outlets')
        .select('id, business_id, outlet_name, printer_ip')
        .eq('id', outletId)
        .single();

      if (error || !outlet) {
        logger.warn(`Print proxy connection with invalid outletId: ${outletId}`);
        ws.close(1008, 'Invalid outletId');
        return;
      }

      // Remove existing connection for this outlet (if any)
      const existingClient = clients.get(outletId);
      if (existingClient) {
        logger.info(`Closing existing print proxy connection for outlet: ${outletId}`);
        existingClient.ws.close(1000, 'Replaced by new connection');
        clients.delete(outletId);
      }

      // Store new client
      const client: PrintProxyClient = {
        ws,
        outletId,
        businessId: outlet.business_id,
        lastPing: Date.now(),
        isAlive: true,
      };
      clients.set(outletId, client);

      logger.info(`Print proxy connected for outlet: ${outlet.outlet_name} (${outletId})`);

      // Handle messages
      ws.on('message', (data) => {
        handleMessage(client, data.toString());
      });

      // Handle pong for keepalive
      ws.on('pong', () => {
        client.isAlive = true;
        client.lastPing = Date.now();
      });

      // Handle close
      ws.on('close', (code, reason) => {
        logger.info(`Print proxy disconnected for outlet ${outletId}: ${code} ${reason}`);
        clients.delete(outletId);
      });

      // Handle error
      ws.on('error', (err) => {
        logger.error(`Print proxy WebSocket error for outlet ${outletId}:`, err);
        clients.delete(outletId);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        outletId,
        outletName: outlet.outlet_name,
        printerIp: outlet.printer_ip,
      }));

    } catch (err) {
      logger.error('Error handling print proxy connection:', err);
      ws.close(1011, 'Server error');
    }
  });

  // Keepalive ping every 30 seconds
  const pingInterval = setInterval(() => {
    clients.forEach((client, outletId) => {
      if (!client.isAlive) {
        logger.warn(`Print proxy keepalive failed for outlet: ${outletId}`);
        client.ws.terminate();
        clients.delete(outletId);
        return;
      }

      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  logger.info('Print Proxy WebSocket server initialized on /ws/print-proxy');
}

/**
 * Handle incoming message from print proxy client
 */
function handleMessage(client: PrintProxyClient, rawData: string): void {
  try {
    const message = JSON.parse(rawData);

    switch (message.type) {
      case 'pong':
        client.isAlive = true;
        client.lastPing = Date.now();
        break;

      case 'print_ack':
        handlePrintAck(message as PrintAck);
        break;

      case 'status':
        logger.debug(`Print proxy status from ${client.outletId}:`, message.status);
        break;

      default:
        logger.warn(`Unknown message type from print proxy: ${message.type}`);
    }
  } catch (err) {
    logger.error('Failed to parse print proxy message:', err);
  }
}

/**
 * Handle print job acknowledgment
 */
function handlePrintAck(ack: PrintAck): void {
  const pending = pendingJobs.get(ack.jobId);

  if (!pending) {
    logger.warn(`Received ack for unknown job: ${ack.jobId}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingJobs.delete(ack.jobId);

  if (ack.success) {
    logger.info(`Print job ${ack.jobId} completed successfully`);
    pending.resolve({ success: true });
  } else {
    logger.error(`Print job ${ack.jobId} failed: ${ack.error}`);
    pending.resolve({ success: false, error: ack.error });
  }
}

/**
 * Check if a print proxy is connected for an outlet
 */
export function isProxyConnected(outletId: string): boolean {
  const client = clients.get(outletId);
  return client !== undefined && client.ws.readyState === WebSocket.OPEN;
}

/**
 * Get connection status for an outlet
 */
export function getProxyStatus(outletId: string): {
  connected: boolean;
  lastPing?: number;
} {
  const client = clients.get(outletId);

  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    return { connected: false };
  }

  return {
    connected: true,
    lastPing: client.lastPing,
  };
}

/**
 * Get all connected proxies for a business
 */
export function getConnectedProxies(businessId: string): Array<{
  outletId: string;
  lastPing: number;
}> {
  const result: Array<{ outletId: string; lastPing: number }> = [];

  clients.forEach((client, outletId) => {
    if (client.businessId === businessId && client.ws.readyState === WebSocket.OPEN) {
      result.push({
        outletId,
        lastPing: client.lastPing,
      });
    }
  });

  return result;
}

/**
 * Send print job to connected proxy
 * Returns a promise that resolves when print is acknowledged
 */
export function sendPrintJob(
  outletId: string,
  job: PrintJob,
  timeoutMs: number = 30000
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = clients.get(outletId);

    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      resolve({ success: false, error: 'Print proxy not connected' });
      return;
    }

    // Set timeout for acknowledgment
    const timeout = setTimeout(() => {
      pendingJobs.delete(job.id);
      resolve({ success: false, error: 'Print job timeout - no acknowledgment received' });
    }, timeoutMs);

    // Store pending job
    pendingJobs.set(job.id, { resolve, timeout });

    // Send job to proxy
    try {
      client.ws.send(JSON.stringify({
        type: 'print_job',
        payload: job,
      }));

      logger.info(`Print job ${job.id} sent to outlet ${outletId}`);
    } catch (err) {
      clearTimeout(timeout);
      pendingJobs.delete(job.id);
      resolve({ success: false, error: 'Failed to send print job' });
    }
  });
}

/**
 * Send ping to specific proxy
 */
export function pingProxy(outletId: string): boolean {
  const client = clients.get(outletId);

  if (!client || client.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  client.ws.send(JSON.stringify({ type: 'ping' }));
  return true;
}

/**
 * Get count of connected proxies
 */
export function getConnectedProxyCount(): number {
  let count = 0;
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      count++;
    }
  });
  return count;
}
