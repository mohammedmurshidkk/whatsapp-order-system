import { Response } from 'express';
import { supabase } from '../../../config/database';
import { AuthRequest, getBusinessId } from '../../../middleware/auth';
import {
  createDeliveryBoy,
  getDeliveryBoys,
  getDeliveryBoyById,
  updateDeliveryBoy,
  deleteDeliveryBoy,
  getAvailableDeliveryBoys,
  isDeliveryBoyAvailable,
  assignDeliveryToOrder,
  formatOrderForDelivery,
} from '../services/deliveryBoyService';
import { sendWhatsAppMessage } from '../../../services/whatsappService';
import { logger } from '../../../utils/logger';

/**
 * List all delivery boys for the business
 */
export async function listDeliveryBoys(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const deliveryBoys = await getDeliveryBoys(businessId);

    res.status(200).json({ delivery_boys: deliveryBoys });
  } catch (error) {
    logger.error('Failed to list delivery boys', error);
    res.status(500).json({ error: 'Failed to fetch delivery boys' });
  }
}

/**
 * Get a single delivery boy
 */
export async function getDeliveryBoy(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const deliveryBoy = await getDeliveryBoyById(businessId, id);

    if (!deliveryBoy) {
      res.status(404).json({ error: 'Delivery boy not found' });
      return;
    }

    res.status(200).json({ delivery_boy: deliveryBoy });
  } catch (error) {
    logger.error('Failed to get delivery boy', error);
    res.status(500).json({ error: 'Failed to fetch delivery boy' });
  }
}

/**
 * Create a new delivery boy
 */
export async function createDeliveryBoyHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, phone } = req.body;

    if (!name || !phone) {
      res.status(400).json({ error: 'name and phone are required' });
      return;
    }

    // Check for duplicate phone
    const existing = await getDeliveryBoys(businessId);
    if (existing.some(db => db.phone === phone)) {
      res.status(400).json({ error: 'A delivery boy with this phone already exists' });
      return;
    }

    const deliveryBoy = await createDeliveryBoy(businessId, name, phone);

    if (!deliveryBoy) {
      res.status(500).json({ error: 'Failed to create delivery boy' });
      return;
    }

    logger.info(`Delivery boy created: ${name} (${phone})`);
    res.status(201).json({ delivery_boy: deliveryBoy });
  } catch (error) {
    logger.error('Failed to create delivery boy', error);
    res.status(500).json({ error: 'Failed to create delivery boy' });
  }
}

/**
 * Update a delivery boy
 */
export async function updateDeliveryBoyHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const { name, phone, is_active } = req.body;

    // Check if exists
    const existing = await getDeliveryBoyById(businessId, id);
    if (!existing) {
      res.status(404).json({ error: 'Delivery boy not found' });
      return;
    }

    // If phone is changing, check for duplicates
    if (phone && phone !== existing.phone) {
      const allDeliveryBoys = await getDeliveryBoys(businessId);
      if (allDeliveryBoys.some(db => db.phone === phone && db.id !== id)) {
        res.status(400).json({ error: 'A delivery boy with this phone already exists' });
        return;
      }
    }

    const updates: { name?: string; phone?: string; is_active?: boolean } = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (is_active !== undefined) updates.is_active = is_active;

    const deliveryBoy = await updateDeliveryBoy(businessId, id, updates);

    if (!deliveryBoy) {
      res.status(500).json({ error: 'Failed to update delivery boy' });
      return;
    }

    logger.info(`Delivery boy updated: ${id}`);
    res.status(200).json({ delivery_boy: deliveryBoy });
  } catch (error) {
    logger.error('Failed to update delivery boy', error);
    res.status(500).json({ error: 'Failed to update delivery boy' });
  }
}

/**
 * Delete a delivery boy
 */
export async function deleteDeliveryBoyHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;

    const existing = await getDeliveryBoyById(businessId, id);
    if (!existing) {
      res.status(404).json({ error: 'Delivery boy not found' });
      return;
    }

    const success = await deleteDeliveryBoy(businessId, id);

    if (!success) {
      res.status(500).json({ error: 'Failed to delete delivery boy' });
      return;
    }

    logger.info(`Delivery boy deleted: ${id}`);
    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete delivery boy', error);
    res.status(500).json({ error: 'Failed to delete delivery boy' });
  }
}

/**
 * Get available delivery boys (within 16h messaging window)
 */
export async function listAvailableDeliveryBoys(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const deliveryBoys = await getAvailableDeliveryBoys(businessId);

    res.status(200).json({ delivery_boys: deliveryBoys });
  } catch (error) {
    logger.error('Failed to get available delivery boys', error);
    res.status(500).json({ error: 'Failed to fetch available delivery boys' });
  }
}

/**
 * Assign a delivery boy to an order and send WhatsApp notification
 */
export async function assignDelivery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { orderId } = req.params;
    const { delivery_boy_id, admin_note } = req.body;

    if (!delivery_boy_id) {
      res.status(400).json({ error: 'delivery_boy_id is required' });
      return;
    }

    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('business_id', businessId)
      .single();

    if (orderError || !order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    // Check if order is for delivery
    if (order.fulfillment_type !== 'delivery') {
      res.status(400).json({ error: 'Cannot assign delivery boy to takeaway order' });
      return;
    }

    // Get delivery boy
    const deliveryBoy = await getDeliveryBoyById(businessId, delivery_boy_id);
    if (!deliveryBoy) {
      res.status(404).json({ error: 'Delivery boy not found' });
      return;
    }

    // Check if delivery boy is available (within messaging window)
    const isAvailable = await isDeliveryBoyAvailable(businessId, delivery_boy_id);
    if (!isAvailable) {
      res.status(400).json({
        error: 'Delivery boy is not available. They need to message the WhatsApp number to start their shift.',
      });
      return;
    }

    // Get customer info
    const { data: customer } = await supabase
      .from('customers')
      .select('name, phone')
      .eq('id', order.customer_id)
      .single();

    // Assign delivery to order
    const adminId = req.user?.id;
    const result = await assignDeliveryToOrder(
      businessId,
      orderId,
      delivery_boy_id,
      adminId,
      admin_note
    );

    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    // Send WhatsApp message to delivery boy
    const message = formatOrderForDelivery(
      order,
      customer?.phone || 'N/A',
      customer?.name || null,
      admin_note
    );

    await sendWhatsAppMessage(deliveryBoy.phone, message);

    logger.info(`Order ${order.order_number} assigned to ${deliveryBoy.name}, WhatsApp sent`);

    res.status(200).json({
      success: true,
      message: `Order assigned to ${deliveryBoy.name}. WhatsApp notification sent.`,
      delivery_boy: {
        id: deliveryBoy.id,
        name: deliveryBoy.name,
        phone: deliveryBoy.phone,
      },
    });
  } catch (error) {
    logger.error('Failed to assign delivery', error);
    res.status(500).json({ error: 'Failed to assign delivery' });
  }
}
