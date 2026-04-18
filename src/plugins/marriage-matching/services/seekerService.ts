// src/plugins/marriage-matching/services/seekerService.ts

import { supabase } from '../../../config/database';
import { Seeker } from '../types';

export async function findOrCreateSeeker(businessId: string, phone: string): Promise<Seeker> {
  const { data: existing } = await supabase
    .from('seekers')
    .select('*')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('seekers')
    .insert({ business_id: businessId, phone })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSeekerByPhone(businessId: string, phone: string): Promise<Seeker | null> {
  const { data } = await supabase
    .from('seekers')
    .select('*')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .single();
  return data ?? null;
}

export async function updateSeeker(id: string, businessId: string, data: Partial<Seeker>): Promise<Seeker> {
  const { data: seeker, error } = await supabase
    .from('seekers')
    .update(data)
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single();
  if (error) throw error;
  return seeker;
}

export async function getSeekers(businessId: string): Promise<Seeker[]> {
  const { data, error } = await supabase
    .from('seekers')
    .select('*')
    .eq('business_id', businessId)
    .order('registered_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function blockSeeker(id: string, businessId: string, blocked: boolean): Promise<void> {
  const { error } = await supabase
    .from('seekers')
    .update({ is_blocked: blocked })
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
}
