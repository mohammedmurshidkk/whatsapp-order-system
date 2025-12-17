import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getNotifications,
  getUnreadNotifications,
  markNotificationRead,
  getUnreadCount,
  markAllNotificationsRead,
} from '../services/notificationService';
import { emitUnreadCount } from '../services/socketService';
import { logger } from '../utils/logger';

/**
 * Get paginated notifications for a business
 */
export async function getNotificationsList(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const notifications = await getNotifications(businessId, limit, offset);

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        hasMore: notifications.length === limit,
      },
    });
  } catch (error) {
    logger.error('Failed to get notifications', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
}

/**
 * Get unread notifications
 */
export async function getUnread(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const notifications = await getUnreadNotifications(businessId);

    res.status(200).json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    logger.error('Failed to get unread notifications', error);
    res.status(500).json({ error: 'Failed to get unread notifications' });
  }
}

/**
 * Get unread count only
 */
export async function getUnreadNotificationCount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const count = await getUnreadCount(businessId);

    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    logger.error('Failed to get unread count', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
}

/**
 * Mark a notification as read
 */
export async function markAsRead(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Notification ID required' });
      return;
    }

    const success = await markNotificationRead(id);
    if (!success) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    // Emit updated count to all connected admins
    const newCount = await getUnreadCount(businessId);
    emitUnreadCount(businessId, newCount);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    logger.error('Failed to mark notification as read', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const businessId = req.user?.business_id;
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const success = await markAllNotificationsRead(businessId);
    if (!success) {
      res.status(500).json({ error: 'Failed to mark all as read' });
      return;
    }

    // Emit zero count to all connected admins
    emitUnreadCount(businessId, 0);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    logger.error('Failed to mark all notifications as read', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
}
