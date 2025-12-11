import { IRouter, Router } from 'express';
import {
  listAddonGroups,
  createAddon,
  updateAddon,
  deleteAddon,
  linkAddonToCategory,
  unlinkAddonFromCategory,
  getCategoryAddons,
} from '../controllers/adminAddonController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// Addon groups
router.get('/groups', listAddonGroups);

// Individual addons
router.post('/', createAddon);
router.put('/:addonId', updateAddon);
router.delete('/:addonId', deleteAddon);

// Category-addon links
router.post('/link', linkAddonToCategory);
router.post('/unlink', unlinkAddonFromCategory);
router.get('/category/:categoryId', getCategoryAddons);

export default router;
