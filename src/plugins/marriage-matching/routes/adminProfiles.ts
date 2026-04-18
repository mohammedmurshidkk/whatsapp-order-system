// src/plugins/marriage-matching/routes/adminProfiles.ts
import { Router } from 'express';
import { authMiddleware } from '../../../middleware/auth';
import { listProfiles, addProfile, editProfile, removeProfile, getDashboardStats } from '../controllers/adminProfileController';

const router:Router = Router();
router.use(authMiddleware);
router.get('/stats', getDashboardStats);
router.get('/', listProfiles);
router.post('/', addProfile);
router.patch('/:id', editProfile);
router.delete('/:id', removeProfile);
export default router;
