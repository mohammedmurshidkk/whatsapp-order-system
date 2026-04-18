// src/plugins/marriage-matching/types.ts

export interface Profile {
  id: string;
  business_id: string;
  profile_code: string;
  name: string;
  gender: 'male' | 'female';
  age?: number;
  height?: string;
  weight?: string;
  skin_tone?: string;
  religion?: string;
  religion_sect?: string;
  location_district?: string;
  location_city?: string;
  location_country?: string;
  education?: string;
  profession?: string;
  income_range?: string;
  marital_status?: string;
  has_children?: boolean;
  children_count?: number;
  languages?: string[];
  description?: string;
  photo_url?: string;
  // Preferences
  preferred_age_min?: number;
  preferred_age_max?: number;
  preferred_location?: string;
  preferred_religion?: string;
  preferred_sect?: string;
  distance_restriction?: string;
  other_demands?: string;
  // Meta
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Seeker {
  id: string;
  business_id: string;
  phone: string;
  name?: string;
  registered_at: string;
  profile_submitted: boolean;
  age?: number;
  gender?: string;
  religion?: string;
  religion_sect?: string;
  location_city?: string;
  location_country?: string;
  profession?: string;
  education?: string;
  description?: string;
  is_blocked: boolean;
}

export interface InterestRequest {
  id: string;
  business_id: string;
  seeker_id: string;
  profile_id: string;
  status: 'pending' | 'contacted' | 'closed';
  admin_note?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  seeker?: Seeker;
  profile?: Profile;
}

export type MarriageIntent =
  | 'search_profiles'
  | 'show_profile'
  | 'express_interest'
  | 'register_seeker'
  | 'collect_seeker_info'
  | 'no_results_found'
  | 'smalltalk';

// Registration steps — stored on session metadata
export type RegistrationStep =
  | 'name'
  | 'age'
  | 'gender'
  | 'religion'
  | 'religion_sect'
  | 'location'
  | 'profession'
  | 'done';
