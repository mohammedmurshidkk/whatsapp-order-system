import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireFeature } from '../middleware/featureMiddleware';
import {
  getNotificationsList,
  getUnread,
  getUnreadNotificationCount,
  markAsRead,
  markAllAsRead,
} from '../controllers/adminNotificationController';

const router: Router = Router();

// All routes require authentication and notifications feature
router.use(authMiddleware);
router.use(requireFeature('notifications'));

// GET /api/notifications - Get paginated notifications
router.get('/', getNotificationsList);

// GET /api/notifications/unread - Get unread notifications
router.get('/unread', getUnread);

// GET /api/notifications/count - Get unread count only
router.get('/count', getUnreadNotificationCount);

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', markAllAsRead);

// PUT /api/notifications/:id/read - Mark single as read
router.put('/:id/read', markAsRead);

export default router;
