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
import { authMiddleware } from '../../../middleware/auth';
import { requireFeature } from '../../../middleware/featureMiddleware';

const router: IRouter = Router();

// All routes require authentication and menu_addons feature
router.use(authMiddleware);
router.use(requireFeature('menu_addons'));

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
