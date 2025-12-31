import { supabase } from '../config/database';
import { Notification } from '../types';
import { logger } from '../utils/logger';
import { emitNewNotification, emitUnreadCount } from './socketService';

/**
 * Create a notification for business admin
 */
export async function notifyBusinessAdmin(
  businessId: string,
  notification: {
    type: string;
    customerId?: string;
    phone?: string;
    imageId?: string;
    message: string;
  }
): Promise<Notification | null> {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      business_id: businessId,
      type: notification.type,
      customer_id: notification.customerId || null,
      customer_phone: notification.phone || null,
      image_id: notification.imageId || null,
      message: notification.message,
      read: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create notification', error);
    return null;
  }

  logger.info(`Notification created: ${notification.type} for business ${businessId}`);

  // Emit real-time notification to connected admins
  const savedNotification = data as Notification;
  emitNewNotification(businessId, {
    id: savedNotification.id,
    type: savedNotification.type,
    customer_phone: savedNotification.customer_phone,
    message: savedNotification.message,
    image_id: savedNotification.image_id,
    read: savedNotification.read,
    created_at: savedNotification.created_at,
  });

  // Also emit updated unread count
  const count = await getUnreadCount(businessId);
  emitUnreadCount(businessId, count);

  return savedNotification;
}

/**
 * Get unread notifications for a business
 */
export async function getUnreadNotifications(businessId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('business_id', businessId)
    .eq('read', false)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to fetch unread notifications', error);
    return [];
  }

  return (data || []) as Notification[];
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(notificationId: string): Promise<boolean> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId);

  if (error) {
    logger.error('Failed to mark notification as read', error);
    return false;
  }

  return true;
}

/**
 * Get all notifications for a business (paginated) with total count
 */
export async function getNotifications(
  businessId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ notifications: Notification[]; total: number }> {
  // Get total count
  const { count, error: countError } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);

  if (countError) {
    logger.error('Failed to get notifications count', countError);
  }

  // Get paginated data
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch notifications', error);
    return { notifications: [], total: 0 };
  }

  return {
    notifications: (data || []) as Notification[],
    total: count || 0,
  };
}

/**
 * Get unread notification count for a business
 */
export async function getUnreadCount(businessId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('read', false);

  if (error) {
    logger.error('Failed to get unread count', error);
    return 0;
  }

  return count || 0;
}

/**
 * Mark all notifications as read for a business
 */
export async function markAllNotificationsRead(businessId: string): Promise<boolean> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('business_id', businessId)
    .eq('read', false);

  if (error) {
    logger.error('Failed to mark all notifications as read', error);
    return false;
  }

  return true;
}
