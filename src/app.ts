import express, { Request, Response, NextFunction, Express } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import webhookRoutes from './routes/webhook';
import sessionRoutes from './routes/session';
// Core admin routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import adminSessionRoutes from './routes/adminSessions';
import adminBusinessRoutes from './routes/adminBusiness';
import adminNotificationRoutes from './routes/adminNotifications';
import adminChatRoutes from './routes/adminChat';
import superadminRoutes from './routes/superadmin';
import whatsappAuthRoutes from './routes/whatsappAuth';
import adminCampaignRoutes from './routes/adminCampaigns';
import adminCustomerRoutes from './routes/adminCustomers';
import adminOrderRoutes from './routes/adminOrders';
import printRoutes from './routes/print';
import superadminUsageRoutes from './routes/superadminUsage';
import analyticsRoutes from './routes/analytics';
import customerProfileRoutes from './routes/customerProfiles';
import aiPromptRoutes from './routes/aiPrompts';
// Plugin routes
import { registerCakeCafeRoutes } from './plugins/cake-cafe/routes';
import { WHATSAPP_PROVIDER } from './config/constants';
import { logger } from './utils/logger';
import { handleTestMessage } from './controllers/webhookController';
import { initializeSocket } from './services/socketService';
import { requestLogger } from './middleware/requestLogger';
import { startCampaignScheduler } from './services/campaignScheduler';
import { initializePlugins } from './plugins';

// Load environment variables
dotenv.config();

const app: Express = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 8080;

// Initialize Socket.IO
initializeSocket(httpServer);

// Middleware
app.use(cors({
  origin: true, // Allow all origins (or specify: ['https://conversa-admin.murshidkk.info'])
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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
app.use('/api/sessions', sessionRoutes);

// Core admin API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin/sessions', adminSessionRoutes);
app.use('/api/business', adminBusinessRoutes);
app.use('/api/notifications', adminNotificationRoutes);
app.use('/api/admin/chat', adminChatRoutes);
app.use('/api/admin/campaigns', adminCampaignRoutes);
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/print', printRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/superadmin/usage', superadminUsageRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/customer-profiles', customerProfileRoutes);
app.use('/api/ai-prompts', aiPromptRoutes);

// Plugin routes
registerCakeCafeRoutes(app);

// WhatsApp authentication routes (for QR code, status)
app.use('/api/whatsapp/auth', whatsappAuthRoutes);

// Test routes (same as webhook for convenience)
app.post('/test/message', handleTestMessage);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler (includes multer errors)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: logger.formatError(err) });

  // Handle multer errors
  if (err.message === 'Only image files are allowed') {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.message?.includes('File too large')) {
    res.status(400).json({ error: 'File size exceeds limit' });
    return;
  }

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
  // Initialize plugin system
  initializePlugins();

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

  // Start campaign scheduler
  startCampaignScheduler();
});

export default app;
