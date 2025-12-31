import { IRouter, Router } from 'express';
import {
  getBusinesses,
  getBusiness,
  createBusiness,
  updateBusiness,
  toggleBusinessStatus,
  addBusinessAdmin,
  deleteBusinessAdmin,
  getBusinessStats,
  getOverviewAnalytics,
  getWebhookStatus,
} from '../controllers/superadminController';
import { authMiddleware, superadminMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication + superadmin role
router.use(authMiddleware);
router.use(superadminMiddleware);

// Business routes
router.get('/businesses', getBusinesses);
router.get('/businesses/:id', getBusiness);
router.post('/businesses', createBusiness);
router.put('/businesses/:id', updateBusiness);
router.patch('/businesses/:id/toggle-status', toggleBusinessStatus);

// Business admin management
router.post('/businesses/:id/admins', addBusinessAdmin);
router.delete('/businesses/:id/admins/:adminId', deleteBusinessAdmin);

// Analytics & Stats (for Tech Provider dashboard)
router.get('/analytics/overview', getOverviewAnalytics);
router.get('/businesses/:id/stats', getBusinessStats);
router.get('/businesses/:id/webhook-status', getWebhookStatus);

export default router;
