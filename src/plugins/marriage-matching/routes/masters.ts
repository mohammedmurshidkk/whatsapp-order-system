import { Router, Request, Response } from 'express';
import { DISTRICTS, PLACES, RELIGIONS, SECTS, MARITAL_STATUSES, HEIGHTS, WEIGHTS } from '../masters/data';

const router = Router();

// GET /api/marriage/masters — static lookup data for dropdowns
router.get('/', (_req: Request, res: Response) => {
  res.json({
    districts: DISTRICTS,
    places: PLACES,
    religions: RELIGIONS,
    sects: SECTS,
    marital_statuses: MARITAL_STATUSES,
    heights: HEIGHTS,
    weights: WEIGHTS,
  });
});

export default router;
