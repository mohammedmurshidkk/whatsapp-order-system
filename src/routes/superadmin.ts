import { IRouter, Router } from 'express';
import {
  getBusinesses,
  getBusiness,
  createBusiness,
  updateBusiness,
  toggleBusinessStatus,
  addBusinessAdmin,
  deleteBusinessAdmin,
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

export default router;
