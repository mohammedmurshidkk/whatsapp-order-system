import { IRouter, Router } from 'express';
import { login, me, changePassword, changePasswordPublic } from '../controllers/authController';
import { authMiddleware } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();

// Public routes
// Rate limit: 5 login attempts per 15 minutes per IP/email
router.post('/login', loginRateLimiter({ windowMs: 900000, maxRequests: 5 }), login);
router.post('/change-password-public', changePasswordPublic); // No auth required

// Protected routes
router.get('/me', authMiddleware, me);
router.post('/change-password', authMiddleware, changePassword);

export default router;
