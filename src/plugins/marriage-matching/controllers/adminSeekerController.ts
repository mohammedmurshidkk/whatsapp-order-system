// src/plugins/marriage-matching/controllers/adminSeekerController.ts

import { Request, Response } from 'express';
import { getSeekers, blockSeeker } from '../services/seekerService';

export async function listSeekers(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const seekers = await getSeekers(businessId);
    res.json({ seekers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSeekerBlock(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const { is_blocked } = req.body;
    await blockSeeker(req.params.id, businessId, is_blocked);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}
