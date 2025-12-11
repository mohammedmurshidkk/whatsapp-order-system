import { IRouter, Router } from 'express';
import { login, me, changePassword } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';

const router: IRouter = Router();

// Public routes
router.post('/login', login);

// Protected routes
router.get('/me', authMiddleware, me);
router.post('/change-password', authMiddleware, changePassword);

export default router;
