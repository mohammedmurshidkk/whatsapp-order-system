import { Router, IRouter } from 'express';
import {
  handleWhatsAppWebhook,
  handleWebhookVerification,
  handleTestMessage,
} from '../controllers/webhookController';
import {
  getOrder,
  getOrdersByCustomer,
  getSession,
} from '../plugins/cake-cafe/controllers/orderController';
import { webhookRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();

// WhatsApp webhook endpoints
router.get('/whatsapp', handleWebhookVerification);
// Rate limit: 30 messages per minute per phone number
router.post('/whatsapp', webhookRateLimiter({ windowMs: 60000, maxRequests: 30 }), handleWhatsAppWebhook);

// Test endpoint for simulating messages
router.post('/test/message', handleTestMessage);

// Order and session endpoints (for debugging/admin)
router.get('/orders/:orderId', getOrder);
router.get('/customers/:customerId/orders', getOrdersByCustomer);
router.get('/sessions/:sessionId', getSession);

export default router;
