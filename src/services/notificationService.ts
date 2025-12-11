import { supabase } from '../config/database';
import { Notification } from '../types';
import { logger } from '../utils/logger';

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
  return data as Notification;
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
 * Get all notifications for a business (paginated)
 */
export async function getNotifications(
  businessId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Failed to fetch notifications', error);
    return [];
  }

  return (data || []) as Notification[];
}
