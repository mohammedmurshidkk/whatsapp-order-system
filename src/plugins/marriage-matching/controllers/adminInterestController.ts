// src/plugins/marriage-matching/controllers/adminInterestController.ts

import { Request, Response } from 'express';
import { getInterestRequests, updateInterestRequest } from '../services/interestService';

export async function listInterests(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const status = req.query.status as 'pending' | 'contacted' | 'closed' | undefined;
    const requests = await getInterestRequests(businessId, status);
    res.json({ requests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateInterest(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const request = await updateInterestRequest(req.params.id, businessId, req.body);
    res.json({ request });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}
