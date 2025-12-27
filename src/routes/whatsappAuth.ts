/**
 * WhatsApp Authentication Routes
 * Routes for QR code display and auth status (webjs provider)
 */

import { Router, IRouter } from 'express';
import {
  getAuthStatus,
  getQRCodeEndpoint,
  getQRCodePage,
  logoutWhatsApp,
} from '../controllers/whatsappAuthController';

const router: IRouter = Router();

// Get authentication status
router.get('/status', getAuthStatus);

// Get QR code as JSON (for API use)
router.get('/qr', getQRCodeEndpoint);

// Get QR code as HTML page (for browser viewing)
router.get('/qr-page', getQRCodePage);

// Logout from WhatsApp
router.post('/logout', logoutWhatsApp);

export default router;
