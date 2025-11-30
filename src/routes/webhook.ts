import { Router } from 'express';
import {
  handleWhatsAppWebhook,
  handleWebhookVerification,
  handleTestMessage,
} from '../controllers/webhookController';
import {
  getOrder,
  getOrdersByCustomer,
  getSession,
} from '../controllers/orderController';

const router = Router();

// WhatsApp webhook endpoints
router.get('/whatsapp', handleWebhookVerification);
router.post('/whatsapp', handleWhatsAppWebhook);

// Test endpoint for simulating messages
router.post('/test/message', handleTestMessage);

// Order and session endpoints (for debugging/admin)
router.get('/orders/:orderId', getOrder);
router.get('/customers/:customerId/orders', getOrdersByCustomer);
router.get('/sessions/:sessionId', getSession);

export default router;
