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
import superadminRoutes from './routes/superadmin';
import { logger } from './utils/logger';
import { handleTestMessage } from './controllers/webhookController';
import { initializeSocket } from './services/socketService';

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
app.use(express.urlencoded({ extended: true }));

// Serve static files (for upload page)
app.use(express.static(path.join(__dirname, '../public')));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

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
app.use('/api/superadmin', superadminRoutes);

// Test routes (same as webhook for convenience)
app.post('/test/message', handleTestMessage);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server (using httpServer for Socket.IO support)
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Test endpoint: POST http://localhost:${PORT}/test/message`);
  logger.info(`WhatsApp webhook: POST http://localhost:${PORT}/webhook/whatsapp`);
  logger.info(`Menu API: http://localhost:${PORT}/api/menu`);
  logger.info(`Socket.IO: ws://localhost:${PORT}`);
});

export default app;
