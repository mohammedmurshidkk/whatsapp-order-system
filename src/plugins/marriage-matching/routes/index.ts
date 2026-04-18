// src/plugins/marriage-matching/routes/index.ts
import { IRouter, Router } from 'express';
import profileRoutes from './adminProfiles';
import seekerRoutes from './adminSeekers';
import interestRoutes from './adminInterests';
import mastersRoutes from './masters';

const router: IRouter = Router();

router.use('/masters', mastersRoutes);
router.use('/profiles', profileRoutes);
router.use('/seekers', seekerRoutes);
router.use('/interests', interestRoutes);

export default router;
