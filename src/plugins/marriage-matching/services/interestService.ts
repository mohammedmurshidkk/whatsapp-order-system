// src/plugins/marriage-matching/services/interestService.ts

import { supabase } from '../../../config/database';
import { InterestRequest } from '../types';

export async function createInterestRequest(
  businessId: string,
  seekerId: string,
  profileId: string
): Promise<InterestRequest> {
  // Prevent duplicate interest for same profile
  const { data: existing } = await supabase
    .from('interest_requests')
    .select('id')
    .eq('business_id', businessId)
    .eq('seeker_id', seekerId)
    .eq('profile_id', profileId)
    .in('status', ['pending', 'contacted'])
    .single();

  if (existing) throw new Error('DUPLICATE_INTEREST');

  const { data, error } = await supabase
    .from('interest_requests')
    .insert({ business_id: businessId, seeker_id: seekerId, profile_id: profileId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getInterestRequests(
  businessId: string,
  status?: 'pending' | 'contacted' | 'closed'
): Promise<InterestRequest[]> {
  let query = supabase
    .from('interest_requests')
    .select(`*, seeker:seekers(*), profile:profiles(*)`)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function updateInterestRequest(
  id: string,
  businessId: string,
  data: { status?: 'pending' | 'contacted' | 'closed'; admin_note?: string }
): Promise<InterestRequest> {
  const { data: request, error } = await supabase
    .from('interest_requests')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single();
  if (error) throw error;
  return request;
}

export async function getPendingCount(businessId: string): Promise<number> {
  const { count } = await supabase
    .from('interest_requests')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'pending');
  return count ?? 0;
}
