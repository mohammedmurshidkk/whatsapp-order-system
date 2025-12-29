import { IRouter, Router } from 'express';
import { login, me, changePassword, changePasswordPublic } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// Public routes
router.post('/login', login);
router.post('/change-password-public', changePasswordPublic); // No auth required

// Protected routes
router.get('/me', authMiddleware, me);
router.post('/change-password', authMiddleware, changePassword);

export default router;
