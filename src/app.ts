import express, { Request, Response, NextFunction, Express } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import webhookRoutes from './routes/webhook';
import menuRoutes from './routes/menu';
import sessionRoutes from './routes/session';
// Admin routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import adminOrderRoutes from './routes/adminOrders';
import adminSessionRoutes from './routes/adminSessions';
import adminMenuRoutes from './routes/adminMenu';
import adminCategoryRoutes from './routes/adminCategories';
import adminAddonRoutes from './routes/adminAddons';
import adminBusinessRoutes from './routes/adminBusiness';
import adminNotificationRoutes from './routes/adminNotifications';
import adminChatRoutes from './routes/adminChat';
import superadminRoutes from './routes/superadmin';
import whatsappAuthRoutes from './routes/whatsappAuth';
import adminCakePricingRoutes from './routes/adminCakePricing';
import adminCakeQuotesRoutes from './routes/adminCakeQuotes';
import adminAmenityRoutes from './routes/adminAmenities';
import { WHATSAPP_PROVIDER } from './config/constants';
import { logger } from './utils/logger';
import { handleTestMessage } from './controllers/webhookController';
import { initializeSocket } from './services/socketService';
import { requestLogger } from './middleware/requestLogger';

// Load environment variables
dotenv.config();

const app: Express = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 8080;

// Initialize Socket.IO
initializeSocket(httpServer);

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(express.urlencoded({ extended: true }));

// Serve static files (for upload page)
app.use(express.static(path.join(__dirname, '../public')));


// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/webhook', webhookRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/sessions', sessionRoutes);

// Admin API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/orders', adminOrderRoutes);
app.use('/api/admin/sessions', adminSessionRoutes);
app.use('/api/admin/menu', adminMenuRoutes);
app.use('/api/categories', adminCategoryRoutes);
app.use('/api/addons', adminAddonRoutes);
app.use('/api/business', adminBusinessRoutes);
app.use('/api/notifications', adminNotificationRoutes);
app.use('/api/admin/chat', adminChatRoutes);
app.use('/api/admin/cake-pricing', adminCakePricingRoutes);
app.use('/api/admin/cake-quotes', adminCakeQuotesRoutes);
app.use('/api/admin/amenities', adminAmenityRoutes);
app.use('/api/superadmin', superadminRoutes);

// WhatsApp authentication routes (for QR code, status)
app.use('/api/whatsapp/auth', whatsappAuthRoutes);

// Test routes (same as webhook for convenience)
app.post('/test/message', handleTestMessage);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: logger.formatError(err) });
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize WhatsApp client for webjs provider
async function initializeWhatsApp(): Promise<void> {
  if (WHATSAPP_PROVIDER === 'webjs') {
    try {
      logger.info('Initializing WhatsApp Web.js client...');

      // Import dynamically to avoid loading when not needed
      const { initializeClient, setMessageHandler } = await import('./services/whatsapp/webjsClient');
      const { handleWebjsMessage } = await import('./controllers/webjsHandler');

      // Set up message handler
      setMessageHandler(handleWebjsMessage);

      // Initialize the client
      await initializeClient();

      logger.info('WhatsApp Web.js initialization started');
      logger.info('Visit /api/whatsapp/auth/qr-page to scan QR code');
    } catch (error) {
      logger.error('Failed to initialize WhatsApp Web.js', { error: logger.formatError(error) });
    }
  } else {
    logger.info('Using Meta WhatsApp Business API');
  }
}

// Start server
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`WhatsApp Provider: ${WHATSAPP_PROVIDER}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Test endpoint: POST http://localhost:${PORT}/test/message`);

  if (WHATSAPP_PROVIDER === 'meta') {
    logger.info(`WhatsApp webhook: POST http://localhost:${PORT}/webhook/whatsapp`);
  } else {
    logger.info(`WhatsApp Auth: http://localhost:${PORT}/api/whatsapp/auth/qr-page`);
  }

  logger.info(`Menu API: http://localhost:${PORT}/api/menu`);
  logger.info(`Socket.IO: ws://localhost:${PORT}`);

  // Initialize WhatsApp after server starts
  initializeWhatsApp();
});

export default app;
