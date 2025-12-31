import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';

let io: SocketIOServer | null = null;

// Map business ID to connected admin sockets
const businessAdminSockets = new Map<string, Set<string>>();

export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*', // Configure based on your frontend URL in production
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Admin joins their business room
    socket.on('join_business', (data: string | { businessId: string }) => {
      // Support both string and object format
      const businessId = typeof data === 'string' ? data : data?.businessId;

      if (!businessId) {
        logger.warn(`Socket ${socket.id} tried to join without businessId`);
        return;
      }

      socket.join(`business_${businessId}`);

      // Track socket for this business
      if (!businessAdminSockets.has(businessId)) {
        businessAdminSockets.set(businessId, new Set());
      }
      businessAdminSockets.get(businessId)!.add(socket.id);

      logger.info(`Socket ${socket.id} joined business room: ${businessId}`);
    });

    // Admin leaves business room
    socket.on('leave_business', (data: string | { businessId: string }) => {
      const businessId = typeof data === 'string' ? data : data?.businessId;
      if (!businessId) return;

      socket.leave(`business_${businessId}`);
      businessAdminSockets.get(businessId)?.delete(socket.id);
      logger.info(`Socket ${socket.id} left business room: ${businessId}`);
    });

    socket.on('disconnect', () => {
      // Clean up from all business rooms
      businessAdminSockets.forEach((sockets, businessId) => {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          logger.debug(`Socket ${socket.id} removed from business ${businessId}`);
        }
      });
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Emit notification to all admin sockets for a business
 */
export function emitToBusinessAdmins(
  businessId: string,
  event: string,
  data: unknown
): void {
  if (!io) {
    logger.warn('Socket.IO not initialized, cannot emit event');
    return;
  }

  io.to(`business_${businessId}`).emit(event, data);
  logger.debug(`Emitted ${event} to business ${businessId}`);
}

/**
 * Emit new notification event
 */
export function emitNewNotification(
  businessId: string,
  notification: {
    id: string;
    type: string;
    customer_phone: string | null;
    message: string | null;
    image_id: string | null;
    read: boolean;
    created_at: string;
  }
): void {
  emitToBusinessAdmins(businessId, 'new_notification', notification);
}

/**
 * Emit updated unread count
 */
export function emitUnreadCount(businessId: string, count: number): void {
  emitToBusinessAdmins(businessId, 'notification_count', { count });
}

/**
 * Emit notification read event (single notification marked as read)
 */
export function emitNotificationRead(businessId: string, notificationId: string): void {
  emitToBusinessAdmins(businessId, 'notification_read', { id: notificationId });
}

/**
 * Emit all notifications read event
 */
export function emitNotificationsReadAll(businessId: string): void {
  emitToBusinessAdmins(businessId, 'notifications_read_all', {});
}

/**
 * Emit new message event for real-time chat
 */
export function emitNewMessage(
  businessId: string,
  message: {
    id: string;
    session_id: string;
    direction: string;
    content: string;
    message_type: string;
    media_url?: string | null;
    media_mime_type?: string | null;
    media_caption?: string | null;
    media_filename?: string | null;
    media_duration?: number | null;
    created_at: string;
  }
): void {
  // Wrap in format frontend expects: { session_id, message }
  emitToBusinessAdmins(businessId, 'new_message', {
    session_id: message.session_id,
    message,
  });
}

/**
 * Emit session update event (new session, AI pause, etc.)
 */
export function emitSessionUpdate(
  businessId: string,
  sessionId: string
): void {
  // Frontend expects { session_id: string }
  emitToBusinessAdmins(businessId, 'session_update', { session_id: sessionId });
}

/**
 * Emit message status update (delivered, read)
 */
export function emitMessageStatus(
  businessId: string,
  data: {
    message_id: string;
    session_id: string;
    status: 'delivered' | 'read';
  }
): void {
  emitToBusinessAdmins(businessId, 'message_status', data);
}
