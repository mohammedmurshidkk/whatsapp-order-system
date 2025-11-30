import { Request, Response } from 'express';
import { getOrderById, getCustomerOrders } from '../services/orderService';
import { getSessionWithItems } from '../services/sessionService';
import { logger } from '../utils/logger';

export async function getOrder(req: Request, res: Response): Promise<void> {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      res.status(400).json({ error: 'Order ID is required' });
      return;
    }

    const order = await getOrderById(orderId);

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.status(200).json(order);
  } catch (error) {
    logger.error('Failed to get order', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}

export async function getOrdersByCustomer(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { customerId } = req.params;

    if (!customerId) {
      res.status(400).json({ error: 'Customer ID is required' });
      return;
    }

    const orders = await getCustomerOrders(customerId);

    res.status(200).json(orders);
  } catch (error) {
    logger.error('Failed to get customer orders', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

export async function getSession(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionWithItems(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.status(200).json(session);
  } catch (error) {
    logger.error('Failed to get session', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}
