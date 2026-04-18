// src/plugins/marriage-matching/services/profileService.ts

import { supabase } from '../../../config/database';
import { Profile } from '../types';

/**
 * Generate profile code: #M001, #F002, etc.
 */
async function generateProfileCode(businessId: string, gender: 'male' | 'female'): Promise<string> {
  const prefix = gender === 'male' ? 'M' : 'F';
  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);
  const seq = (count ?? 0) + 1;
  return `#${prefix}${String(seq).padStart(3, '0')}`;
}

export async function createProfile(
  businessId: string,
  data: Omit<Profile, 'id' | 'business_id' | 'profile_code' | 'created_at' | 'updated_at'>
): Promise<Profile> {
  const profile_code = await generateProfileCode(businessId, data.gender);
  const { data: profile, error } = await supabase
    .from('profiles')
    .insert({ ...data, business_id: businessId, profile_code })
    .select()
    .single();
  if (error) throw error;
  return profile;
}

export async function getProfiles(businessId: string, activeOnly = true): Promise<Profile[]> {
  let query = supabase
    .from('profiles')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getProfileByCode(businessId: string, profileCode: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('business_id', businessId)
    .eq('profile_code', profileCode)
    .eq('is_active', true)
    .single();
  if (error) return null;
  return data;
}

export async function updateProfile(
  id: string,
  businessId: string,
  data: Partial<Profile>
): Promise<Profile> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single();
  if (error) throw error;
  return profile;
}

export async function deleteProfile(id: string, businessId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
}

/**
 * Search profiles by preferences.
 * Returns active profiles filtered by optional criteria.
 */
export async function searchProfiles(
  businessId: string,
  filters: {
    gender?: string;
    religion?: string;
    religion_sect?: string;
    location_city?: string;
    location_district?: string;
    age_min?: number;
    age_max?: number;
    profession?: string;
    education?: string;
  }
): Promise<Profile[]> {
  let query = supabase
    .from('profiles')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (filters.gender) query = query.eq('gender', filters.gender);
  if (filters.religion) query = query.ilike('religion', `%${filters.religion}%`);
  if (filters.religion_sect) query = query.ilike('religion_sect', `%${filters.religion_sect}%`);
  if (filters.location_city) query = query.ilike('location_city', `%${filters.location_city}%`);
  if (filters.location_district) query = query.ilike('location_district', `%${filters.location_district}%`);
  if (filters.age_min) query = query.gte('age', filters.age_min);
  if (filters.age_max) query = query.lte('age', filters.age_max);
  if (filters.profession) query = query.ilike('profession', `%${filters.profession}%`);
  if (filters.education) query = query.ilike('education', `%${filters.education}%`);

  // Fetch 30 candidates so JS scoring can rank from a larger pool before slicing to top 5
  const { data, error } = await query.order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return data ?? [];
}
