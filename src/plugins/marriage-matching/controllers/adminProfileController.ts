// src/plugins/marriage-matching/controllers/adminProfileController.ts

import { Request, Response } from 'express';
import {
  createProfile,
  getProfiles,
  updateProfile,
  deleteProfile,
} from '../services/profileService';
import { getPendingCount } from '../services/interestService';

export async function listProfiles(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const activeOnly = req.query.active !== 'false';
    const profiles = await getProfiles(businessId, activeOnly);
    res.json({ profiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function addProfile(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const profile = await createProfile(businessId, req.body);
    res.status(201).json({ profile });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function editProfile(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const profile = await updateProfile(req.params.id, businessId, req.body);
    res.json({ profile });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function removeProfile(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    await deleteProfile(req.params.id, businessId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function getDashboardStats(req: Request, res: Response) {
  try {
    const businessId = (req as any).user.business_id;
    const [profiles, pending] = await Promise.all([
      getProfiles(businessId, true),
      getPendingCount(businessId),
    ]);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newThisWeek = profiles.filter(p => p.created_at >= oneWeekAgo).length;
    res.json({
      total_active_profiles: profiles.length,
      new_profiles_this_week: newThisWeek,
      pending_interest_requests: pending,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
