/**
 * WhatsApp Authentication Controller
 * Handles QR code display and authentication status for whatsapp-web.js
 */

import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { WHATSAPP_PROVIDER } from '../config/constants';
import { getQRCode, isClientReady, logout } from '../services/whatsapp/webjsClient';
import { getProviderStatus } from '../services/whatsapp';
import { logger } from '../utils/logger';

/**
 * Get current authentication status
 * GET /api/whatsapp/auth/status
 */
export async function getAuthStatus(_req: Request, res: Response): Promise<void> {
  const status = getProviderStatus();

  res.json({
    ...status,
    provider: WHATSAPP_PROVIDER,
  });
}

/**
 * Get QR code for authentication (webjs only)
 * GET /api/whatsapp/auth/qr
 */
export async function getQRCodeEndpoint(_req: Request, res: Response): Promise<void> {
  if (WHATSAPP_PROVIDER !== 'webjs') {
    res.status(400).json({
      error: 'QR code authentication is only for webjs provider',
      provider: WHATSAPP_PROVIDER,
    });
    return;
  }

  const qr = getQRCode();

  if (!qr) {
    if (isClientReady()) {
      res.json({
        status: 'authenticated',
        message: 'WhatsApp is already connected',
      });
    } else {
      res.json({
        status: 'waiting',
        message: 'QR code not yet generated. Client is initializing...',
      });
    }
    return;
  }

  try {
    // Generate QR code as data URL
    const qrImageDataUrl = await QRCode.toDataURL(qr, {
      width: 300,
      margin: 2,
    });

    res.json({
      status: 'pending',
      message: 'Scan this QR code with WhatsApp',
      qrCode: qrImageDataUrl,
    });
  } catch (error) {
    logger.error('Failed to generate QR code image:', error);
    res.status(500).json({
      error: 'Failed to generate QR code',
    });
  }
}

/**
 * Get QR code as HTML page (for easy viewing)
 * GET /api/whatsapp/auth/qr-page
 */
export async function getQRCodePage(_req: Request, res: Response): Promise<void> {
  if (WHATSAPP_PROVIDER !== 'webjs') {
    res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>QR Authentication Not Available</h2>
          <p>Current provider: <strong>${WHATSAPP_PROVIDER}</strong></p>
          <p>QR code is only needed for whatsapp-web.js provider.</p>
        </body>
      </html>
    `);
    return;
  }

  const qr = getQRCode();

  if (!qr) {
    if (isClientReady()) {
      res.send(`
        <html>
          <head>
            <meta http-equiv="refresh" content="5">
          </head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>✅ WhatsApp Connected!</h2>
            <p>WhatsApp Web is already authenticated and ready.</p>
          </body>
        </html>
      `);
    } else {
      res.send(`
        <html>
          <head>
            <meta http-equiv="refresh" content="3">
          </head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>⏳ Waiting for QR Code...</h2>
            <p>WhatsApp client is initializing. Page will refresh automatically.</p>
          </body>
        </html>
      `);
    }
    return;
  }

  try {
    const qrImageDataUrl = await QRCode.toDataURL(qr, {
      width: 300,
      margin: 2,
    });

    res.send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="30">
          <title>WhatsApp QR Login</title>
        </head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>📱 Scan QR Code with WhatsApp</h2>
          <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>
          <img src="${qrImageDataUrl}" alt="WhatsApp QR Code" style="margin: 20px;">
          <p style="color: #666;">Page refreshes automatically. Once scanned, you'll see success message.</p>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Failed to generate QR code page:', error);
    res.status(500).send('Failed to generate QR code');
  }
}

/**
 * Logout from WhatsApp (webjs only)
 * POST /api/whatsapp/auth/logout
 */
export async function logoutWhatsApp(_req: Request, res: Response): Promise<void> {
  if (WHATSAPP_PROVIDER !== 'webjs') {
    res.status(400).json({
      error: 'Logout is only for webjs provider',
      provider: WHATSAPP_PROVIDER,
    });
    return;
  }

  try {
    await logout();
    res.json({
      success: true,
      message: 'Logged out from WhatsApp. Scan QR code to reconnect.',
    });
  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({
      error: 'Failed to logout',
    });
  }
}
