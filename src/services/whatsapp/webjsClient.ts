/**
 * WhatsApp Web.js Client Singleton
 * Manages the whatsapp-web.js client instance and authentication
 */

import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';
import { execSync } from 'child_process';
import { logger } from '../../utils/logger';
import { ProviderStatus } from './types';

/**
 * Find Chrome/Chromium executable path on the system
 */
function findChromePath(): string | undefined {
  // 1. Custom path from env takes highest priority
  if (process.env.CHROME_PATH) {
    try {
      execSync(`test -f "${process.env.CHROME_PATH}"`, { stdio: 'ignore' });
      logger.info(`Using Chrome from CHROME_PATH: ${process.env.CHROME_PATH}`);
      return process.env.CHROME_PATH;
    } catch {
      logger.warn(`CHROME_PATH set but file not found: ${process.env.CHROME_PATH}`);
    }
  }

  // 2. Check common paths for all platforms
  const possiblePaths = [
    // Linux
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // Mac - Homebrew Chromium (more compatible than Google Chrome)
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Mac - Google Chrome (may have version issues)
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  for (const chromePath of possiblePaths) {
    try {
      execSync(`test -f "${chromePath}"`, { stdio: 'ignore' });
      logger.info(`Found Chrome at: ${chromePath}`);
      return chromePath;
    } catch {
      // Path doesn't exist, continue
    }
  }

  // 3. Try 'which' command on Linux/Mac
  try {
    const path = execSync('which chromium-browser || which chromium || which google-chrome 2>/dev/null', {
      encoding: 'utf-8',
    }).trim();
    if (path) {
      logger.info(`Found Chrome via which: ${path}`);
      return path;
    }
  } catch {
    // Not found
  }

  // 4. Return undefined - puppeteer will try its bundled Chromium
  logger.info('No system Chrome found - Puppeteer will use bundled Chromium');
  return undefined;
}

// Client state
let client: Client | null = null;
let qrCodeData: string | null = null;
let isReady = false;
let isInitializing = false;
let lastError: string | null = null;

// Message handler callback (set by webjsHandler)
let messageHandler: ((message: Message) => Promise<void>) | null = null;

/**
 * Get the WhatsApp client instance
 */
export function getClient(): Client | null {
  return client;
}

/**
 * Check if client is ready to send/receive messages
 */
export function isClientReady(): boolean {
  return isReady;
}

/**
 * Get current QR code for authentication
 */
export function getQRCode(): string | null {
  return qrCodeData;
}

/**
 * Get provider status
 */
export function getStatus(): ProviderStatus {
  return {
    ready: isReady,
    provider: 'webjs',
    needsAuth: !isReady && qrCodeData !== null,
    error: lastError || undefined,
  };
}

/**
 * Set message handler callback
 */
export function setMessageHandler(handler: (message: Message) => Promise<void>): void {
  messageHandler = handler;
}

/**
 * Initialize the WhatsApp Web client
 */
export async function initializeClient(): Promise<void> {
  if (isInitializing) {
    logger.warn('WhatsApp client is already initializing');
    return;
  }

  if (isReady && client) {
    logger.info('WhatsApp client is already ready');
    return;
  }

  isInitializing = true;
  lastError = null;

  try {
    logger.info('Initializing WhatsApp Web client...');

    // Find Chrome executable
    const chromePath = findChromePath();
    if (chromePath) {
      logger.info(`Using Chrome at: ${chromePath}`);
    } else {
      logger.warn('No Chrome found - will try Puppeteer bundled Chromium');
    }

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './whatsapp-session',
      }),
      puppeteer: {
        headless: true,
        executablePath: chromePath, // Use system Chrome if found
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
          '--no-zygote',
        ],
      },
    });

    // QR Code event - display for authentication
    client.on('qr', (qr: string) => {
      qrCodeData = qr;
      isReady = false;
      logger.info('QR Code received - scan with WhatsApp to authenticate');
      logger.info('Visit /api/whatsapp/auth/qr to get QR code image');
      // Also show in terminal for convenience
      qrcodeTerminal.generate(qr, { small: true });
    });

    // Ready event - client is authenticated and ready
    client.on('ready', () => {
      isReady = true;
      qrCodeData = null;
      lastError = null;
      logger.info('✅ WhatsApp Web client is ready!');
    });

    // Authenticated event
    client.on('authenticated', () => {
      logger.info('WhatsApp Web client authenticated successfully');
    });

    // Authentication failure
    client.on('auth_failure', (msg: string) => {
      logger.error('WhatsApp authentication failed:', msg);
      isReady = false;
      lastError = `Authentication failed: ${msg}`;
    });

    // Disconnected event
    client.on('disconnected', (reason: string) => {
      logger.warn('WhatsApp client disconnected:', reason);
      isReady = false;
      qrCodeData = null;
      lastError = `Disconnected: ${reason}`;

      // Auto-reconnect after delay
      setTimeout(() => {
        if (!isReady && !isInitializing) {
          logger.info('Attempting to reconnect WhatsApp client...');
          initializeClient().catch((err) => {
            logger.error('Reconnection failed:', err);
          });
        }
      }, 10000);
    });

    // Message event - forward to handler
    client.on('message', async (message: Message) => {
      if (messageHandler) {
        try {
          await messageHandler(message);
        } catch (error) {
          logger.error('Error in message handler:', error);
        }
      } else {
        logger.warn('No message handler registered, ignoring message');
      }
    });

    // Message create event (for sent messages confirmation)
    client.on('message_create', (message: Message) => {
      if (message.fromMe) {
        logger.debug(`Message sent: ${message.body.substring(0, 50)}...`);
      }
    });

    // Initialize the client
    await client.initialize();
    logger.info('WhatsApp Web client initialization started');
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to initialize WhatsApp client:', error);
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * Destroy the client connection
 */
export async function destroyClient(): Promise<void> {
  if (client) {
    try {
      await client.destroy();
      logger.info('WhatsApp client destroyed');
    } catch (error) {
      logger.error('Error destroying WhatsApp client:', error);
    }
    client = null;
    isReady = false;
    qrCodeData = null;
  }
}

/**
 * Logout and clear session
 */
export async function logout(): Promise<void> {
  if (client) {
    try {
      await client.logout();
      logger.info('WhatsApp client logged out');
    } catch (error) {
      logger.error('Error logging out:', error);
    }
    isReady = false;
    qrCodeData = null;
  }
}

// ============================================
// GRACEFUL SHUTDOWN HANDLERS
// Only runs when this module is loaded (webjs provider)
// ============================================

let isShuttingDown = false;

/**
 * Gracefully shutdown the WhatsApp client and Chrome processes
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn(`[WebJS] Already shutting down, ignoring ${signal}`);
    return;
  }

  isShuttingDown = true;
  logger.info(`[WebJS] Received ${signal}, shutting down gracefully...`);

  try {
    // Destroy the WhatsApp client (closes Puppeteer/Chrome)
    if (client) {
      logger.info('[WebJS] Destroying WhatsApp client...');
      await Promise.race([
        destroyClient(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Destroy timeout')), 5000)
        ),
      ]);
      logger.info('[WebJS] WhatsApp client destroyed successfully');
    }
  } catch (error) {
    logger.error('[WebJS] Error during graceful shutdown:', error);
  }

  // Force kill any remaining Chrome processes (last resort)
  try {
    const { exec } = await import('child_process');
    exec('pkill -f "chromium.*whatsapp-session" 2>/dev/null || true');
  } catch {
    // Ignore errors - process might not exist
  }

  logger.info('[WebJS] Shutdown complete');

  // Exit after cleanup
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle nodemon restart signal
process.on('SIGUSR2', async () => {
  logger.info('[WebJS] Received SIGUSR2 (nodemon restart)');
  await gracefulShutdown('SIGUSR2');
  process.kill(process.pid, 'SIGUSR2');
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  logger.error('[WebJS] Uncaught exception:', error);
  await gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason) => {
  logger.error('[WebJS] Unhandled rejection:', reason);
  // Don't exit on unhandled rejection, just log it
});

logger.info('[WebJS] Graceful shutdown handlers registered');
