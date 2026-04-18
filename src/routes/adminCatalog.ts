import { IRouter, Router } from 'express';
import {
  syncToCatalog,
  syncItemToCatalog,
  removeFromCatalog,
  getSyncStatus,
  getSettings,
  updateSettings,
  testConnection,
} from '../controllers/adminCatalogController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// All routes require authentication
router.use(authMiddleware);

// Catalog settings
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/test-connection', testConnection);

// Sync operations
router.post('/sync', syncToCatalog); // Accepts optional { itemIds: string[] } in body
router.post('/sync/:itemId', syncItemToCatalog);

// Get sync status for all items
router.get('/status', getSyncStatus);

// Remove item from catalog
router.delete('/:itemId', removeFromCatalog);

export default router;
